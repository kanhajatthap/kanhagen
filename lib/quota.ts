import type { ObjectId, Db } from "mongodb";

/**
 * Daily free-token/credit quota.
 *
 * Every user gets a fixed number of credits per UTC day so the free tier can't
 * be hammered by automation. The counts live in MongoDB (collection `quotas`,
 * one doc per user per day) instead of memory, so they survive restarts and
 * work across multiple instances. Credits reset at midnight UTC = 5:30 AM IST,
 * and every quota message shows the exact next reset date+time so the user
 * knows when they can generate again.
 *
 * Defaults (overridable via env):
 *   FREE_IMAGE_CREDITS = 5   → lets the user create ~4-5 images a day
 *   FREE_TEXT_CREDITS  = 30  → a bit more slack for chat / questions
 */

export type QuotaKind = "image" | "text";

interface QuotaDoc {
  _id?: ObjectId;
  userId: string;
  day: string; // e.g. "2026-09-25" (UTC)
  images: number;
  text: number;
}

export const IMAGE_CREDITS_PER_DAY = Number(process.env.FREE_IMAGE_CREDITS) || 5;
export const TEXT_CREDITS_PER_DAY = Number(process.env.FREE_TEXT_CREDITS) || 30;

async function ensureQuotaIndexes(db: Db) {
  const col = db.collection<QuotaDoc>("quotas");
  await col.createIndex({ userId: 1, day: 1 }, { unique: true });
  return col;
}

/** UTC calendar day key for a timestamp. */
export function quotaDay(now: number | Date = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface QuotaReset {
  /** UTC day key for the period the timestamp belongs to (e.g. "2026-09-25"). */
  day: string;
  /** Epoch ms of the moment the quota resets (midnight UTC → 5:30 AM IST). */
  resetAtMs: number;
  /** Human "date + time (IST)" label shown to the user. */
  resetLabel: string;
}

const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

/** Returns the current quota window key and when it refills (in IST terms). */
export function getQuotaReset(now: number | Date = Date.now()): QuotaReset {
  const ms = typeof now === "number" ? now : now.getTime();
  const day = quotaDay(ms);
  const next = new Date(ms);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    day,
    resetAtMs: next.getTime(),
    resetLabel: IST_FORMATTER.format(new Date(next.getTime())),
  };
}

export interface QuotaState {
  kind: QuotaKind;
  limit: number;
  used: number;
  remaining: number;
  resetAtMs: number;
  resetLabel: string;
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly state: Omit<QuotaState, "used" | "remaining"> & { used: number },
  ) {
    super(
      `Daily ${state.kind === "image" ? "image" : "chat"} credits exhausted for today ` +
        `(used ${state.used}/${state.limit}).`,
    );
    this.name = "QuotaExceededError";
  }
}

export function quotaLimit(kind: QuotaKind): number {
  return kind === "image" ? IMAGE_CREDITS_PER_DAY : TEXT_CREDITS_PER_DAY;
}

function toState(kind: QuotaKind, doc: QuotaDoc | null, reset: QuotaReset): QuotaState {
  const used = doc ? (kind === "image" ? doc.images : doc.text) ?? 0 : 0;
  const limit = quotaLimit(kind);
  return {
    kind,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAtMs: reset.resetAtMs,
    resetLabel: reset.resetLabel,
  };
}

/**
 * Returns the user's current quota state for a kind without charging anything.
 * Safe to call on every request to refresh the UI counters.
 */
export async function getQuotaState(db: Db, userId: string, kind: QuotaKind): Promise<QuotaState> {
  const col = await ensureQuotaIndexes(db);
  const reset = getQuotaReset();
  const doc = await col.findOne<QuotaDoc>({ userId, day: reset.day });
  return toState(kind, doc, reset);
}

/** Full picture (both kinds) for GET /api/quota. */
export async function getQuotaOverview(db: Db, userId: string) {
  const reset = getQuotaReset();
  const [image, text] = await Promise.all([
    getQuotaState(db, userId, "image"),
    getQuotaState(db, userId, "text"),
  ]);
  return {
    image,
    text,
    resetAt: new Date(reset.resetAtMs).toISOString(),
    resetLabel: reset.resetLabel,
  };
}

/**
 * Atomically charges `n` credits of a kind for the current day. If that pushes
 * the user past their daily limit the credits are refunded and a
 * `QuotaExceededError` (with the exact refill date+time) is thrown. Returns the
 * post-charge state.
 */
export async function spendQuota(db: Db, userId: string, kind: QuotaKind, n = 1): Promise<QuotaState> {
  const col = await ensureQuotaIndexes(db);
  const reset = getQuotaReset();

  const budget = n;

  // Filter on the day only; $inc the bucket. If this overspends the limit we
  // immediately refund so a burst of concurrent requests can't over-charge.
  const result = await col.findOneAndUpdate(
    { userId, day: reset.day },
    { $inc: { [kind === "image" ? "images" : "text"]: budget } },
    { upsert: true, returnDocument: "after" },
  );
  const doc = (result as unknown as QuotaDoc | null) ?? null;
  const used = doc ? (kind === "image" ? doc.images : doc.text) : budget;
  const limit = quotaLimit(kind);

  if (used > limit) {
    await col.updateOne(
      { userId, day: reset.day },
      { $inc: { [kind === "image" ? "images" : "text"]: -budget } },
    );
    throw new QuotaExceededError({ kind, limit, used: used - budget, resetAtMs: reset.resetAtMs, resetLabel: reset.resetLabel });
  }

  return toState(kind, doc, reset);
}

/**
 * Gives back `n` credits that were charged by `spendQuota` but never turned
 * into a result (provider failure, aborted batch, ...). Never lets a bucket go
 * negative, so a double refund can't hand a user free credits.
 */
export async function refundQuota(db: Db, userId: string, kind: QuotaKind, n = 1): Promise<QuotaState> {
  const col = await ensureQuotaIndexes(db);
  const reset = getQuotaReset();
  const field = kind === "image" ? "images" : "text";
  const amount = Math.max(0, Math.trunc(n));

  if (amount > 0) {
    await col.updateOne(
      { userId, day: reset.day },
      { $inc: { [field]: -amount } },
    );
    // Clamp at zero: a refund must never make the counter negative.
    await col.updateOne(
      { userId, day: reset.day, [field]: { $lt: 0 } },
      { $set: { [field]: 0 } },
    );
  }

  const doc = await col.findOne<QuotaDoc>({ userId, day: reset.day });
  return toState(kind, doc, reset);
}

/** Builds the friendly, time-aware message the APIs send back on exhaustion. */
export function quotaExceededMessage(kind: QuotaKind, resetLabel: string): string {
  const thing = kind === "image" ? "image credits" : "chat credits";
  return `Aaj ke free ${thing} khatam ho gaye (daily limit: ${
    kind === "image" ? IMAGE_CREDITS_PER_DAY : TEXT_CREDITS_PER_DAY
  }). Agla credit ${resetLabel} (IST) ko milega.`;
}