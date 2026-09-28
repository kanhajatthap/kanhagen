import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "../../../lib/mongodb";
import { checkRateLimit } from "../../../lib/rateLimit";
import { buildVariations, type Variation } from "../../../lib/providers";
import { QuotaExceededError, refundQuota, spendQuota } from "../../../lib/quota";
import { quotaErrorResponse } from "../../../lib/httpError";
import {
  getSessionUser,
  isImageGenerationRequest,
  parseChatRequest,
  resolveConversationId,
  UploadError,
} from "../../../lib/chat/common";
import { handleTextTurn } from "../../../lib/chat/text";
import { handleImageTurn } from "../../../lib/chat/image";
import { handleVisionTurn } from "../../../lib/chat/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Multiplexing entry point for the in-app chat.
 *
 * The heavy logic lives in focused modules (`lib/chat/*`) which are also
 * exposed directly as `/api/text` and `/api/vision`. This route only decides
 * which mode the message is:
 *   1. uploaded image + "similar/variation" words  -> variations
 *   2. uploaded image                              -> vision (understand it)
 *   3. prompt with image keywords                  -> image generation
 *   4. anything else                               -> text chat
 */
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = await parseChatRequest(req);
  } catch (e) {
    if (e instanceof UploadError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    console.warn("[chat] Rejected malformed request:", e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  if (!parsed.prompt && !parsed.uploadedImage) {
    return NextResponse.json({ success: false, error: "Missing prompt or image." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Please login to generate." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(user.userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  try {
    const db = await getDb();
    const conversationId = await resolveConversationId(db, user.userId, parsed.historyId);
    const prompt = parsed.prompt;
    const uploadedImage = parsed.uploadedImage;

    // Variation request — take an uploaded image and produce similar images.
    const isSimilarRequest = /\b(similar|variation|variations|like this|similar to this)\b/i.test(prompt);
    if (uploadedImage && isSimilarRequest) {
      const cleanPrompt =
        prompt.replace(/\b(similar|variation|variations|like this|similar to this)\b/gi, "").trim() ||
        "similar image";

      const variationCount = 4;

      // Each variation is a generated image, so reserve its credit up front.
      try {
        await spendQuota(db, user.userId, "image", variationCount);
      } catch (quotaErr) {
        if (quotaErr instanceof QuotaExceededError) return quotaErrorResponse(quotaErr);
        throw quotaErr;
      }

      let variations: Variation[];
      try {
        variations = buildVariations({
          prompt: cleanPrompt,
          width: 1024,
          height: 1024,
          model: "flux",
          count: variationCount,
        });
      } catch (e) {
        // The URLs are built locally, so this should not fail — but if it does,
        // give the credits back rather than charging for nothing.
        await refundQuota(db, user.userId, "image", variationCount);
        throw e;
      }

      const newId = new ObjectId();
      await db.collection("image_history").insertOne({
        _id: newId,
        userId: user.userId,
        prompt: cleanPrompt,
        type: "image",
        imageBase64: uploadedImage.buffer.toString("base64"),
        mimeType: uploadedImage.mimeType || "image/png",
        public: false,
        conversationId: conversationId || newId.toString(),
        createdAt: new Date(),
      });

      return NextResponse.json(
        {
          success: true,
          type: "variations",
          variations,
          historyId: conversationId || newId.toString(),
          prompt: cleanPrompt,
          message: "Generated similar images",
        },
        { status: 200 },
      );
    }

    // Vision: an image is attached (with or without a question).
    if (uploadedImage) {
      return await handleVisionTurn(db, user, prompt, uploadedImage.buffer, uploadedImage.mimeType, conversationId);
    }

    // Image generation.
    if (!parsed.forceText && isImageGenerationRequest(prompt)) {
      return await handleImageTurn(db, user, prompt, conversationId, parsed.isPublic);
    }

    // Everything else is a text conversation.
    return await handleTextTurn(db, user, parsed);
  } catch (e) {
    console.error("[chat] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Server error." }, { status: 500 });
  }
}
