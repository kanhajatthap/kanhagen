import { NextResponse } from "next/server";
import { getDb } from "../../../lib/mongodb";
import { checkRateLimit } from "../../../lib/rateLimit";
import { handleTextTurn } from "../../../lib/chat/text";
import { getSessionUser, sanitizeHistory } from "../../../lib/chat/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dedicated text-chat endpoint (streaming SSE or JSON). All "ask a question"
 * calls route here — chat, follow-ups, prompt-enhancer. One chat credit is
 * charged per turn.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const historyId = typeof body?.historyId === "string" ? body.historyId.trim() : "";
  const textModel =
    body?.textModel === "gemini" || body?.textModel === "pollinations" ? body.textModel : "auto";

  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Please login to generate." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(user.userId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  const db = await getDb();
  return handleTextTurn(db, user, {
    prompt,
    historyId,
    discussionHistory: sanitizeHistory(body?.history),
    streamRequested: body?.stream === true,
    forceText: body?.forceText === true,
    textModel,
    isPublic: body?.isPublic === true,
  });
}
