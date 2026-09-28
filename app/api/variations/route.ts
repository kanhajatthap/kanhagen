import { NextResponse } from "next/server";
import { getDb } from "../../../lib/mongodb";
import { checkRateLimit } from "../../../lib/rateLimit";
import { getSessionUser } from "../../../lib/chat/common";
import { buildVariations } from "../../../lib/providers";
import { QuotaExceededError, spendQuota } from "../../../lib/quota";
import { quotaErrorResponse } from "../../../lib/httpError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 2000;

export async function POST(req: Request) {
  const body = await req.json().catch((e) => {
    console.error("JSON parse error:", e);
    return null;
  });

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : "";
  const width = typeof body?.width === "number" ? body.width : 1024;
  const height = typeof body?.height === "number" ? body.height : 1024;
  const model = typeof body?.model === "string" ? body.model : "flux";
  const style = typeof body?.style === "string" ? body.style.slice(0, 200) : undefined;
  const variationCount = Math.min(Math.max(typeof body?.count === "number" ? body.count : 4), 6);

  if (!prompt) {
    return NextResponse.json({ error: "Missing prompt." }, { status: 400 });
  }

  // The user is always the session owner. A `userId` in the body is ignored —
  // trusting it would let anyone burn another account's daily quota.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Please login to generate variations." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`variations:${user.userId}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait before trying again.", retryAfter: rateLimit.retryAfter },
      { status: 429 },
    );
  }

  try {
    // Each variation is one generated image, so it costs one image credit.
    const db = await getDb();
    try {
      await spendQuota(db, user.userId, "image", variationCount);
    } catch (quotaErr) {
      if (quotaErr instanceof QuotaExceededError) return quotaErrorResponse(quotaErr);
      throw quotaErr;
    }

    const variations = buildVariations({ prompt, width, height, model, style, count: variationCount });

    return NextResponse.json(
      {
        success: true,
        variations,
        originalPrompt: prompt,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Variations generation error:", error);
    return NextResponse.json({ error: "Failed to generate variations." }, { status: 500 });
  }
}
