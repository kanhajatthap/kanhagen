import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "../../../lib/mongodb";
import { deriveImageMime } from "../../../lib/imageMime";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session";
import { checkRateLimit } from "../../../lib/rateLimit";
import { getCachedImage, setCachedImage } from "../../../lib/cache";
import { addWatermark } from "../../../lib/watermark";
import { buildImageUrl, PollinationsError, fetchPollinationsText, POLLINATIONS_TEXT_BASE } from "../../../lib/pollinations";
import { generateImageWithFallback, getConfiguredProviders, ProviderError } from "../../../lib/providers";
import { QuotaExceededError, refundQuota, spendQuota } from "../../../lib/quota";
import { quotaErrorResponse } from "../../../lib/httpError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Helper to check if prompt is asking for an image
function isImagePrompt(prompt: string): boolean {
  const imageKeywords = /\b(image|photo|picture|generate|create|draw|paint|sketch|illustration)\b/i;
  return imageKeywords.test(prompt);
}

// Helper to encode prompt for URL
function encodePrompt(prompt: string): string {
  return encodeURIComponent(prompt);
}

// Helper to enhance prompt with style
function enhancePromptWithStyle(prompt: string, style?: string): string {
  if (!style || style === "none") return prompt;
  return `${prompt}, ${style} style, highly detailed, cinematic lighting`;
}

// Image settings interface
interface ImageSettings {
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
  style?: string;
  enhance?: boolean;
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "The Generate API is active and functioning! Send a POST request with { prompt } to generate text or images using Pollinations AI.",
    providers: getConfiguredProviders(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch((e) => {
    console.error("JSON parse error:", e);
    return null;
  });

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const historyId = typeof body?.historyId === "string" ? body.historyId.trim() : null;
  // Images are private unless the caller explicitly opts in to the public gallery.
  const isPublic = body?.isPublic === true;

  const settings: ImageSettings = {
    width: typeof body?.width === "number" ? body.width : undefined,
    height: typeof body?.height === "number" ? body.height : undefined,
    seed: typeof body?.seed === "number" ? body.seed : Math.floor(Math.random() * 10000000),
    model: typeof body?.model_type === "string" ? body.model_type : (typeof body?.model === "string" ? body.model : "flux"),
    style: typeof body?.style === "string" ? body.style : undefined,
    enhance: typeof body?.enhance === "boolean" ? body.enhance : false,
  };

  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken ? await verifySessionToken(sessionToken) : null;

    if (!session?.userId) {
      return NextResponse.json({ error: "Please login to generate." }, { status: 401 });
    }

    const rateLimit = checkRateLimit(session.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait before trying again.", retryAfter: rateLimit.retryAfter },
        { status: 429 }
      );
    }

    const shouldGenerateImage = isImagePrompt(prompt);
    const finalPrompt = settings.style ? enhancePromptWithStyle(prompt, settings.style) : prompt;
    const encodedPrompt = encodePrompt(finalPrompt);

    if (shouldGenerateImage) {
      const cached = getCachedImage(finalPrompt, settings.width, settings.height, settings.seed, settings.model, settings.style);

      let imageBuffer: Buffer;
      let contentType: string;
      let imageUrl: string;
      let usedProvider: string;

      // A cache hit costs no provider credits, so only charge when we actually
      // generate (and refund if every provider fails).
      let charged = false;
      const dbForQuota = await getDb();
      if (!cached) {
        try {
          await spendQuota(dbForQuota, session.userId, "image", 1);
          charged = true;
        } catch (quotaErr) {
          if (quotaErr instanceof QuotaExceededError) return quotaErrorResponse(quotaErr);
          throw quotaErr;
        }
      }

      if (cached) {
        imageBuffer = Buffer.from(cached.data, "base64") as Buffer;
        // Re-derive from the cached bytes rather than trusting the cached
        // content-type, which came from an upstream response header.
        contentType = deriveImageMime(imageBuffer);
        usedProvider = cached.provider;
        imageUrl =
          cached.provider === "pollinations"
            ? buildImageUrl(encodedPrompt, {
                width: settings.width,
                height: settings.height,
                seed: settings.seed,
                model: settings.model,
              })
            : `data:${cached.mimeType};base64,${cached.data}`;
      } else {
        let generated: Awaited<ReturnType<typeof generateImageWithFallback>>;
        try {
          generated = await generateImageWithFallback({
            prompt: finalPrompt,
            width: settings.width,
            height: settings.height,
            seed: settings.seed,
            model: settings.model,
            style: settings.style,
          });
        } catch (e) {
          if (charged) {
            await refundQuota(dbForQuota, session.userId, "image", 1).catch((rErr) =>
              console.error("Quota refund failed:", rErr),
            );
          }
          throw e;
        }

        const watermarkedBuffer = await addWatermark(generated.buffer);

        imageBuffer = watermarkedBuffer;
        contentType = "image/png";
        usedProvider = generated.provider;
        imageUrl =
          generated.provider === "pollinations" && generated.url
            ? generated.url
            : `data:${generated.mimeType};base64,${watermarkedBuffer.toString("base64")}`;

        setCachedImage(finalPrompt, watermarkedBuffer.toString("base64"), contentType, settings.width, settings.height, settings.seed, settings.model, settings.style, usedProvider);
      }

      const db = await getDb();
      const history = db.collection("image_history");
      await history.createIndex({ userId: 1, createdAt: -1 });

      let resultHistoryId: string | null = null;

      if (historyId && ObjectId.isValid(historyId)) {
        await history.updateOne(
          { _id: new ObjectId(historyId), userId: session.userId },
          {
            $push: {
              messages: {
                $each: [
                  { role: "user", content: prompt, createdAt: new Date() },
                  { role: "assistant", content: "Image generated", imageBase64: imageBuffer.toString("base64"), createdAt: new Date() },
                ],
              },
            } as unknown as import("mongodb").Document,
            $set: {
              imageBase64: imageBuffer.toString("base64"),
              mimeType: contentType,
              seed: settings.seed,
              updatedAt: new Date()
            },
          }
        );
        resultHistoryId = historyId;
      } else {
        const result = await history.insertOne({
          userId: session.userId,
          prompt,
          model: `${usedProvider}-image`,
          mimeType: contentType,
          imageBase64: imageBuffer.toString("base64"),
          seed: settings.seed,
          width: settings.width,
          height: settings.height,
          style: settings.style,
          public: isPublic,
          messages: [
            { role: "user", content: prompt, createdAt: new Date() },
            { role: "assistant", content: "Image generated", imageBase64: imageBuffer.toString("base64"), createdAt: new Date() },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        resultHistoryId = result.insertedId.toString();
      }

      return NextResponse.json({
        type: "image",
        url: imageUrl,
        provider: usedProvider,
        historyId: resultHistoryId,
        settings: {
          width: settings.width,
          height: settings.height,
          seed: settings.seed,
          model: settings.model,
          style: settings.style,
        }
      }, { status: 200 });

    } else {
      const textUrl = `${POLLINATIONS_TEXT_BASE}/${encodedPrompt}`;

      const db = await getDb();
      try {
        await spendQuota(db, session.userId, "text", 1);
      } catch (quotaErr) {
        if (quotaErr instanceof QuotaExceededError) return quotaErrorResponse(quotaErr);
        throw quotaErr;
      }

      let generatedText: string;
      try {
        generatedText = await fetchPollinationsText(textUrl);
      } catch (e) {
        await refundQuota(db, session.userId, "text", 1).catch((rErr) =>
          console.error("Quota refund failed:", rErr),
        );
        throw e;
      }

      const history = db.collection("image_history");
      await history.createIndex({ userId: 1, createdAt: -1 });

      let resultHistoryId: string | null = null;

      if (historyId && ObjectId.isValid(historyId)) {
        await history.updateOne(
          { _id: new ObjectId(historyId), userId: session.userId },
          {
            $push: {
              messages: {
                $each: [
                  { role: "user", content: prompt, createdAt: new Date() },
                  { role: "assistant", content: generatedText, createdAt: new Date() },
                ],
              },
            } as unknown as import("mongodb").Document,
            $set: { updatedAt: new Date() },
          }
        );
        resultHistoryId = historyId;
      } else {
        const result = await history.insertOne({
          userId: session.userId,
          prompt,
          model: "pollinations-text",
          mimeType: "text/plain",
          generatedText,
          messages: [
            { role: "user", content: prompt, createdAt: new Date() },
            { role: "assistant", content: generatedText, createdAt: new Date() },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        resultHistoryId = result.insertedId.toString();
      }

      return NextResponse.json({
        type: "text",
        text: generatedText,
        historyId: resultHistoryId
      }, { status: 200 });
    }

  } catch (e) {
    console.error("Generate API error:", e);
    if (e instanceof PollinationsError || e instanceof ProviderError) {
      // `message` is already a user-safe string; `details` may carry upstream
      // hostnames/URLs so it is logged, never returned.
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error." }, { status: 502 });
  }
}
