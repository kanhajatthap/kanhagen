import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/mongodb";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { getClientIp } from "../../../../lib/request";
import { buildResetUrl, issuePasswordReset } from "../../../../lib/passwordReset";
import { sendPasswordResetEmail } from "../../../../lib/mailer";
import { CAPTCHA_FIELD, verifyCaptcha } from "../../../../lib/turnstile";

export const runtime = "nodejs";

/**
 * Forgot password — step 1 of 2.
 *
 * The response is intentionally identical whether or not the address is
 * registered: anything else turns this endpoint into a membership oracle for
 * every email on the internet. Timing is also flattened, because a fast "no such
 * user" reply leaks the same fact that the message text tries to hide.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 3;

// Same generic answer for every outcome, including errors.
const GENERIC_RESPONSE = {
  message: "If that email is registered, a password reset link is on its way.",
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !email.includes("@") || email.length > 254) {
    return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
  }

  const ip = getClientIp(req);

  // Bot gate. This endpoint is the best target for automated abuse (it costs the
  // attacker nothing and can mail-bomb an inbox), so the captcha is checked
  // before the rate limit buckets are charged — a rejected bot shouldn't be
  // able to lock a real user out by burning their quota.
  //
  // The rejection is a plain 403 with a fixed message, deliberately not the
  // generic 200, so a broken captcha integration is visible instead of silently
  // letting every request through. It says nothing about whether the address
  // exists.
  const captcha = await verifyCaptcha(body?.[CAPTCHA_FIELD], { remoteIp: ip, expectedAction: "forgot_password" });
  if (!captcha.ok) {
    console.warn(`[forgot-password] captcha rejected (${captcha.reason}) from ${ip}`);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 403 });
  }

  // Per-IP stops one host spraying many addresses; per-email stops one address
  // being used to flood an inbox. Both are needed — either alone is bypassable.
  for (const [key, max] of [
    [`forgot:ip:${ip}`, MAX_PER_IP],
    [`forgot:email:${email}`, MAX_PER_EMAIL],
  ] as const) {
    const limit = checkRateLimit(key, WINDOW_MS, max);
    if (!limit.allowed) {
      return NextResponse.json(
        { ...GENERIC_RESPONSE, retryAfter: limit.retryAfter },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } },
      );
    }
  }

  let previewUrl: string | undefined;

  try {
    const db = await getDb();
    const user = await db
      .collection("users")
      .findOne<{ _id: unknown; email: string }>({ email }, { projection: { email: 1 } });

    if (user) {
      const token = await issuePasswordReset(db, String(user._id), { requestIp: ip });
      const resetUrl = buildResetUrl(new URL(req.url).origin, token);
      const mail = await sendPasswordResetEmail(user.email, resetUrl);

      // Only ever populated in development, so the link can be used locally.
      previewUrl = mail.previewUrl;
    } else {
      // Equalise the cost against the "user found" branch above.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch (error) {
    console.error("Forgot password error:", error);
    // Still answer generically: a 500 here would reveal that the address exists.
    return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
  }

  return NextResponse.json(
    { ...GENERIC_RESPONSE, ...(previewUrl ? { devResetUrl: previewUrl } : {}) },
    { status: 200 },
  );
}
