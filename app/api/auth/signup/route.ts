import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/mongodb";
import { createSessionToken, SESSION_COOKIE_NAME } from "../../../../lib/session";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { getClientIp } from "../../../../lib/request";
import { CAPTCHA_FIELD, verifyCaptcha } from "../../../../lib/turnstile";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (name.length < 2) {
    return NextResponse.json({ error: "Name must be at least 2 characters." }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  // Bot gate. Checked after the free local validation (so malformed junk costs
  // no upstream call) but before the bcrypt hash and the database write, which
  // are the expensive parts worth protecting.
  const ip = getClientIp(req);
  const captcha = await verifyCaptcha(body?.[CAPTCHA_FIELD], { remoteIp: ip, expectedAction: "signup" });
  if (!captcha.ok) {
    console.warn(`[signup] captcha rejected (${captcha.reason}) from ${ip}`);
    return NextResponse.json({ error: "Verification failed. Please try again.", code: captcha.reason }, { status: 403 });
  }

  try {
    const db = await getDb();

    // One signup per IP per window to stop abuse. The IP comes from the
    // right-most X-Forwarded-For hop so a client can't rotate a fake header
    // to get a fresh bucket on every attempt.
    const signupLimit = checkRateLimit(`signup:${ip}`);
    if (!signupLimit.allowed) {
      return NextResponse.json(
        { error: "Too many signups from this address. Please wait and try again.", retryAfter: signupLimit.retryAfter },
        { status: 429 },
      );
    }

    const users = db.collection("users");
    await users.createIndex({ email: 1 }, { unique: true });

    const exists = await users.findOne({ email });
    if (exists) {
      return NextResponse.json({ error: "Email is already registered." }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await users.insertOne({
      name,
      email,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const userId = (inserted.insertedId as ObjectId).toHexString();
    const sessionToken = await createSessionToken({ userId, email, name });
    const cookieStore = await cookies();

    cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.json({ message: "Signup successful.", user: { name, email } }, { status: 201 });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
  }
}
