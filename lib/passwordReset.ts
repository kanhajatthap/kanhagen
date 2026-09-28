import { createHash, randomBytes } from "node:crypto";
import type { Db, ObjectId } from "mongodb";

/**
 * Password reset tokens.
 *
 * Security properties this file is responsible for:
 *
 *  - **The raw token is never stored.** Only its SHA-256 hash goes to Mongo, so
 *    a database dump can't be turned into working reset links. The same reason
 *    reset tokens don't need to be bcrypt'd: they're 256 bits of CSPRNG output,
 *    so a fast hash is not brute-forceable.
 *  - **Single use.** Consumption is a single `findOneAndUpdate` that stamps
 *    `usedAt`, so two concurrent requests with the same token cannot both win.
 *  - **Time limited** (1 hour) and bounded to the *latest* token per account, so
 *    requesting a new link invalidates the previous one.
 *  - **Expired rows self-delete** via a Mongo TTL index.
 *
 * `usedAt` is set *before* the password is written and cleared again if the
 * write fails, so a transient DB error doesn't lock the user out of the one
 * link they legitimately requested.
 */

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** 32 random bytes, base64url — 43 chars, no padding. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check so garbage never reaches the database. */
export function isValidResetToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

interface PasswordResetDoc {
  _id?: ObjectId;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  requestIp?: string;
}

const COLLECTION = "password_resets";

function collection(db: Db) {
  return db.collection<PasswordResetDoc>(COLLECTION);
}

/** Idempotent; safe to await on every issue/consume. */
async function ensureIndexes(db: Db) {
  const col = collection(db);
  await col.createIndex({ tokenHash: 1 }, { unique: true });
  // Mongo drops expired documents for us, so the collection stays small.
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await col.createIndex({ userId: 1, usedAt: 1 });
}

/**
 * Builds the link that goes in the email.
 *
 * The configured base is preferred over the request origin: on Vercel the
 * request `Host` header is derived from the deployment that received it, which
 * is not necessarily the canonical host a user should be sent back to. A
 * request-derived origin is only trusted as a last resort, and only when it is
 * a plain http(s) URL, so a forged header cannot be injected into the email.
 *
 * `APP_URL` is server-only on purpose — it must not use the `NEXT_PUBLIC_`
 * prefix, which would inline it into the client bundle for no benefit.
 */
export function buildResetUrl(origin: string, token: string): string {
  const candidates = [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, origin];
  const base = candidates.find(isUsableBase) ?? "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

function isUsableBase(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Issues a fresh token for a user, invalidating any earlier unused ones.
 * Returns the raw token — the caller is responsible for delivering it and must
 * not persist it.
 */
export async function issuePasswordReset(
  db: Db,
  userId: string,
  meta: { requestIp?: string } = {},
): Promise<string> {
  await ensureIndexes(db);
  const col = collection(db);
  const now = new Date();

  // Only the newest link works; burn the older ones.
  await col.updateMany({ userId, usedAt: null }, { $set: { usedAt: now } });

  const token = generateResetToken();
  await col.insertOne({
    userId,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + RESET_TTL_MS),
    usedAt: null,
    createdAt: now,
    requestIp: meta.requestIp,
  });

  return token;
}

/**
 * Atomically marks a token used and returns the owning userId, or null if the
 * token is unknown, already used, or expired.
 */
export async function consumePasswordReset(db: Db, token: string): Promise<string | null> {
  if (!isValidResetToken(token)) return null;

  await ensureIndexes(db);
  const now = new Date();

  const claimed = await collection(db).findOneAndUpdate(
    { tokenHash: hashResetToken(token), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  );

  const doc = (claimed as unknown as PasswordResetDoc | null) ?? null;
  return doc?.userId ?? null;
}

/** Un-claims a token so a failed password write can be retried. */
export async function releasePasswordReset(db: Db, token: string): Promise<void> {
  if (!isValidResetToken(token)) return;
  await collection(db).updateOne(
    { tokenHash: hashResetToken(token), usedAt: { $ne: null } },
    { $set: { usedAt: null } },
  );
}

/** Removes a token outright, once the password change has succeeded. */
export async function deletePasswordReset(db: Db, token: string): Promise<void> {
  if (!isValidResetToken(token)) return;
  await collection(db).deleteOne({ tokenHash: hashResetToken(token) });
}
