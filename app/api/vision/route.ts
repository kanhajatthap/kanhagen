import { NextResponse } from "next/server";
import { getDb } from "../../../lib/mongodb";
import { checkRateLimit } from "../../../lib/rateLimit";
import { handleVisionTurn } from "../../../lib/chat/vision";
import {
  assertBodySizeWithinLimit,
  getSessionUser,
  readUploadedImage,
  resolveConversationId,
  UploadError,
} from "../../../lib/chat/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dedicated vision endpoint: uploads an image (single file + optional prompt)
 * and gets an AI description / answer / extracted text. Uses one chat credit.
 */
export async function POST(req: Request) {
  let prompt = "";
  let historyId = "";
  let upload: { buffer: Buffer; mimeType: string };

  try {
    assertBodySizeWithinLimit(req);
    const formData = await req.formData();
    prompt = ((formData.get("prompt") as string) || "").trim();
    historyId = (formData.get("historyId") as string) || "";
    upload = await readUploadedImage(formData.get("image") as File | null);
  } catch (e) {
    if (e instanceof UploadError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.warn("[vision] Rejected malformed upload:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Please login to generate." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`vision:${user.userId}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  const db = await getDb();
  const conversationId = await resolveConversationId(db, user.userId, historyId);

  return handleVisionTurn(db, user, prompt, upload.buffer, upload.mimeType, conversationId);
}
