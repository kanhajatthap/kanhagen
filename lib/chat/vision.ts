import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";
import { analyzeImage } from "../vision";
import { QuotaExceededError, refundQuota, spendQuota } from "../quota";
import { quotaErrorResponse } from "../httpError";
import type { SessionUser } from "./common";

/**
 * Answers questions about an uploaded image (Gemini vision, OCR fallback).
 * Uses one chat credit, same bucket as text questions.
 */
export async function handleVisionTurn(
  db: Db,
  user: SessionUser,
  prompt: string,
  imageBuffer: Buffer,
  imageMimeType: string,
  conversationId: string | null,
): Promise<Response> {
  try {
    await spendQuota(db, user.userId, "text", 1);
  } catch (e) {
    if (e instanceof QuotaExceededError) return quotaErrorResponse(e);
    throw e;
  }

  try {
    const visionPrompt = prompt || "Extract all text from this image.";
    const { text, visionFrom } = await analyzeImage(imageBuffer, imageMimeType, visionPrompt);

    const newId = new ObjectId();
    await db.collection("image_history").insertOne({
      _id: newId,
      userId: user.userId,
      type: "vision",
      imageBase64: imageBuffer.toString("base64"),
      mimeType: imageMimeType,
      prompt: visionPrompt,
      response: text,
      visionFrom,
      conversationId: conversationId || newId.toString(),
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      type: "vision",
      text,
      uploadedImageUrl: `data:${imageMimeType};base64,${imageBuffer.toString("base64")}`,
      prompt: visionPrompt,
      historyId: conversationId || newId.toString(),
    }, { status: 200 });
  } catch (error) {
    console.error("Vision API error:", error);
    // The user got no answer, so give the credit back.
    await refundQuota(db, user.userId, "text", 1).catch((e) =>
      console.error("Quota refund failed:", e),
    );
    return NextResponse.json({ success: false, error: "Failed to analyze image." }, { status: 500 });
  }
}
