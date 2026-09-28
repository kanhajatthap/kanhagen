import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/mongodb";
import { createSessionToken, SESSION_COOKIE_NAME } from "../../../../lib/session";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { getClientIp } from "../../../../lib/request";
import { CAPTCHA_FIELD, verifyCaptcha } from "../../../../lib/turnstile";

export const runtime = "nodejs";

/**
 * A bcrypt hash of a value nobody can supply. Comparing against it when the
 * email doesn't exist makes the "no such user" path cost the same as a wrong
 * password, so response timing can't be used to enumerate accounts.
 */
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  // Throttle per-IP and per-account so neither a single host spraying many
  // emails nor many hosts hammering one account gets unlimited guesses.
  const ip = getClientIp(req);

  // Bot gate before anything expensive. The error deliberately doesn't say
  // whether the captcha or the credentials were the problem.
  const captcha = await verifyCaptcha(body?.[CAPTCHA_FIELD], { remoteIp: ip, expectedAction: "login" });
  if (!captcha.ok) {
    console.warn(`[login] captcha rejected (${captcha.reason}) from ${ip}`);
    return NextResponse.json({ error: "Verification failed. Please try again.", code: captcha.reason }, { status: 403 });
  }

  for (const [scope, key] of [["ip", `login:ip:${ip}`], ["account", `login:acct:${email}`]] as const) {
    const limit = checkRateLimit(key, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS);
    if (!limit.allowed) {
      console.warn(`[login] throttled (${scope}) for ${scope === "ip" ? ip : "an account"}`);
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later.", retryAfter: limit.retryAfter },
        { status: 429 },
      );
    }
  }

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne<{ _id: unknown; name: string; email: string; passwordHash: string }>({ email });

    // Always run a bcrypt comparison so the missing-user and wrong-password
    // paths take indistinguishable time.
    const validPassword = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

    if (!user || !user.passwordHash || !validPassword) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const userId = String(user._id);
    const sessionToken = await createSessionToken({
      userId,
      email: user.email,
      name: user.name || "User",
    });

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json(
      { message: "Login successful.", user: { name: user.name || "User", email: user.email } },
      { status: 200 },
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Failed to login." }, { status: 500 });
  }
}
