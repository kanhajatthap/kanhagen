import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { deriveImageMime } from "../../../lib/imageMime";
import { getDb } from "../../../lib/mongodb";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session";
import { PollinationsError } from "../../../lib/pollinations";
import { generateImageWithFallback, ProviderError } from "../../../lib/providers";
import { checkRateLimit } from "../../../lib/rateLimit";
import { QuotaExceededError, refundQuota, spendQuota } from "../../../lib/quota";
import { quotaErrorResponse } from "../../../lib/httpError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const count = Math.min(Math.max(parseInt(body?.count || "4", 10), 1), 8);
  const width = typeof body?.width === "number" ? body.width : 1024;
  const height = typeof body?.height === "number" ? body.height : 1024;
  const model = typeof body?.model === "string" ? body.model : "flux";
  const style = typeof body?.style === "string" ? body.style : undefined;
  const historyId = typeof body?.historyId === "string" ? body.historyId.trim() : "";
  // Private unless the caller explicitly opts in to the public gallery.
  const isPublic = body?.isPublic === true;

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
        { status: 429 },
      );
    }

    // Reserve daily credits up front — a batch of N images costs N credits.
    const db = await getDb();
    try {
      await spendQuota(db, session.userId, "image", count);
    } catch (quotaErr) {
      if (quotaErr instanceof QuotaExceededError) return quotaErrorResponse(quotaErr);
      throw quotaErr;
    }

    const stylePrompt = style && style !== "none" ? `${prompt}, ${style} style, highly detailed` : prompt;

    const generateOne = async (seed: number) => {
      const { buffer, mimeType } = await generateImageWithFallback({
        prompt: stylePrompt,
        width,
        height,
        seed,
        model,
        style,
      });
      return { buffer, mimeType, seed };
    };

    const seeds = Array.from({ length: count }, () => Math.floor(Math.random() * 10000000));
    let results: Array<{ buffer: Buffer; mimeType: string; seed: number }>;
    try {
      results = await Promise.all(seeds.map((seed) => generateOne(seed)));
    } catch (e) {
      // A failed batch produced no saved images, so refund the whole batch.
      await refundQuota(db, session.userId, "image", count).catch((rErr) =>
        console.error("Quota refund failed:", rErr),
      );
      throw e;
    }

    const history = db.collection("image_history");

    // Resolve the conversation id so follow-up batches stay in the same chat.
    let conversationId: string | null = null;
    if (historyId && ObjectId.isValid(historyId)) {
      const existing = await history.findOne(
        { _id: new ObjectId(historyId), userId: session.userId },
        { projection: { conversationId: 1 } },
      );
      if (existing) {
        conversationId =
          typeof existing.conversationId === "string" && existing.conversationId
            ? existing.conversationId
            : historyId;
      }
    }

    const imageBase64 = results[0].buffer.toString("base64");
    const newId = new ObjectId();
    await history.insertOne({
      _id: newId,
      userId: session.userId,
      prompt,
      model: `batch-${model}`,
      mimeType: deriveImageMime(results[0].buffer),
      imageBase64,
      seed: results[0].seed,
      width,
      height,
      style,
      public: isPublic,
      type: "batch",
      conversationId: conversationId || newId.toString(),
      batchResults: results.map((r) => ({
        seed: r.seed,
        imageBase64: r.buffer.toString("base64"),
        // Derived from the bytes, not the provider's content-type header.
        mimeType: deriveImageMime(r.buffer),
      })),
      messages: [
        { role: "user", content: `Batch generate: ${prompt} (${count} images)`, createdAt: new Date() },
        { role: "assistant", content: `Generated ${count} images`, createdAt: new Date() },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      type: "batch",
      historyId: conversationId || newId.toString(),
      images: results.map((r, i) => ({
        id: `${newId}-${i}`,
        url: `/api/history/${newId}/image${i > 0 ? `?n=${i}` : ""}`,
        seed: r.seed,
      })),
    }, { status: 200 });
  } catch (e) {
    console.error("Batch generation error:", e);
    if (e instanceof PollinationsError || e instanceof ProviderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: "Batch generation failed. Please try again in a moment." },
      { status: 502 },
    );
  }
}
