import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/mongodb";
import { checkRateLimit } from "../../../../lib/rateLimit";
import { getClientIp } from "../../../../lib/request";
import {
  consumePasswordReset,
  deletePasswordReset,
  isValidResetToken,
  releasePasswordReset,
} from "../../../../lib/passwordReset";

export const runtime = "nodejs";

/**
 * Forgot password — step 2 of 2.
 *
 * The token *is* the authorisation. It is checked for shape, claimed
 * atomically, and released again if the password write fails so a transient DB
 * error doesn't burn the user's only link.
 *
 * Every failure returns the same message, so a caller can't distinguish "no such
 * token" from "expired" from "already used".
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

const INVALID = {
  error: "This reset link is invalid or has expired. Please request a new one.",
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = body?.token;
  const password = typeof body?.password === "string" ? body.password : "";
  const confirm = typeof body?.confirmPassword === "string" ? body.confirmPassword : password;

  if (!isValidResetToken(token)) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    // bcrypt silently ignores bytes past 72, so refuse rather than mislead.
    return NextResponse.json({ error: "Password is too long (max 200 characters)." }, { status: 400 });
  }
  if (password !== confirm) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  const limit = checkRateLimit(`reset:${getClientIp(req)}`, WINDOW_MS, MAX_ATTEMPTS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ...INVALID, retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } },
    );
  }

  let db: Awaited<ReturnType<typeof getDb>> | null = null;
  let claimed = false;

  try {
    db = await getDb();
    const userId = await consumePasswordReset(db, token);
    if (!userId) {
      return NextResponse.json(INVALID, { status: 400 });
    }
    claimed = true;

    const passwordHash = await bcrypt.hash(password, 10);
    // Signup inserts without an explicit _id, so it is an ObjectId; fall back to
    // a string _id in case an older account was imported differently.
    const result = ObjectId.isValid(userId)
      ? await db.collection("users").updateOne(
          { _id: new ObjectId(userId) },
          { $set: { passwordHash, updatedAt: new Date() } },
        )
      : await db
          .collection("users")
          .updateOne({ _id: userId as unknown as ObjectId }, { $set: { passwordHash, updatedAt: new Date() } });

    if (result.matchedCount === 0) {
      // The account was deleted between issuing and using the link.
      await deletePasswordReset(db, token);
      return NextResponse.json(INVALID, { status: 400 });
    }

    await deletePasswordReset(db, token);

    // Deliberately no session cookie is issued here: the user should sign in
    // with the new password on a fresh request.
    return NextResponse.json({ message: "Password updated. You can sign in now." }, { status: 200 });
  } catch (error) {
    console.error("Reset password error:", error);
    // Hand the link back if we were the ones who consumed it.
    if (claimed && db) {
      try {
        await releasePasswordReset(db, token);
      } catch (releaseError) {
        console.error("Failed to release reset token:", releaseError);
      }
    }
    return NextResponse.json({ error: "Failed to update password. Please try again." }, { status: 500 });
  }
}
