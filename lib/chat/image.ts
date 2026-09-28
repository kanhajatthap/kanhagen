import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";
import { generateImageWithFallback, ProviderError } from "../providers";
import { PollinationsError } from "../pollinations";
import { QuotaExceededError, refundQuota, spendQuota } from "../quota";
import { deriveImageMime } from "../imageMime";
import { quotaErrorResponse } from "../httpError";
import type { SessionUser } from "./common";

/**
 * Generates a single image for a chat turn. Charges one image credit before
 * hitting any provider so the free-tier cap actually protects the API bills, and
 * refunds it if every provider fails. Images are private unless `isPublic` is
 * explicitly requested.
 */
export async function handleImageTurn(
  db: Db,
  user: SessionUser,
  prompt: string,
  conversationId: string | null,
  isPublic = false,
): Promise<Response> {
  try {
    await spendQuota(db, user.userId, "image", 1);
  } catch (e) {
    if (e instanceof QuotaExceededError) return quotaErrorResponse(e);
    throw e;
  }

  try {
    const { buffer, provider } = await generateImageWithFallback({
      prompt,
      width: 1024,
      height: 1024,
      seed: Math.floor(Math.random() * 10000000),
      model: "flux",
    });
    const base64Data = buffer.toString("base64");
    // Derived from the bytes: the provider's content-type header is untrusted
    // and ends up verbatim in a Content-Type response header.
    const mimeType = deriveImageMime(buffer);
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const newId = new ObjectId();
    await db.collection("image_history").insertOne({
      _id: newId,
      userId: user.userId,
      prompt,
      model: `${provider}-image`,
      type: "image",
      imageBase64: base64Data,
      mimeType,
      public: isPublic,
      conversationId: conversationId || newId.toString(),
      createdAt: new Date(),
    });

    return NextResponse.json({
      type: "image",
      url: dataUrl,
      historyId: conversationId || newId.toString(),
    }, { status: 200 });
  } catch (error) {
    console.error("Image generation error:", error);
    // The user got no image, so they should not pay a credit for it.
    await refundQuota(db, user.userId, "image", 1).catch((e) =>
      console.error("Quota refund failed:", e),
    );
    if (error instanceof PollinationsError || error instanceof ProviderError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Failed to generate image. Please try again in a moment." },
      { status: 502 },
    );
  }
}
