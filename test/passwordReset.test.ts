import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  RESET_TTL_MS,
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  isValidResetToken,
  issuePasswordReset,
  consumePasswordReset,
  releasePasswordReset,
  deletePasswordReset,
} from "../lib/passwordReset";

/**
 * In-memory stand-in for the `password_resets` collection, implementing only
 * what lib/passwordReset calls.
 */
function makeFakeDb() {
  type Doc = {
    _id: ObjectId;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    requestIp?: string;
  };
  const rows = new Map<string, Doc>();
  let seq = 0;

  const db = {
    collection: () => ({
      createIndex: async () => undefined,
      insertOne: async (doc: Omit<Doc, "_id">) => {
        rows.set(doc.tokenHash, { _id: new ObjectId(), ...doc });
        return { insertedId: rows.get(doc.tokenHash)!._id };
      },
      findOneAndUpdate: async (
        filter: { tokenHash: string; usedAt: null; expiresAt: { $gt: Date } },
        update: { $set: { usedAt: Date } },
      ) => {
        const doc = rows.get(filter.tokenHash);
        if (!doc) return null;
        if (filter.usedAt === null && doc.usedAt !== null) return null;
        if (doc.expiresAt.getTime() <= filter.expiresAt.$gt.getTime()) return null;
        doc.usedAt = update.$set.usedAt;
        return doc;
      },
      updateMany: async (filter: { userId: string; usedAt: null }, update: { $set: { usedAt: Date } }) => {
        let n = 0;
        for (const doc of rows.values()) {
          if (doc.userId === filter.userId && doc.usedAt === null) {
            doc.usedAt = update.$set.usedAt;
            n++;
          }
        }
        return { modifiedCount: n };
      },
      updateOne: async (
        filter: { tokenHash: string; usedAt?: { $ne: null } },
        update: { $set: { usedAt: Date | null } },
      ) => {
        const doc = rows.get(filter.tokenHash);
        if (!doc) return { matchedCount: 0 };
        if (filter.usedAt && doc.usedAt === null) return { matchedCount: 0 };
        doc.usedAt = update.$set.usedAt;
        return { matchedCount: 1 };
      },
      deleteOne: async (filter: { tokenHash: string }) => {
        return { deletedCount: rows.delete(filter.tokenHash) ? 1 : 0 };
      },
      peek: () => [...rows.values()],
    }),
  };

  return { db: db as unknown as Db, rows: () => [...rows.values()], count: () => rows.size, _seq: () => seq++ };
}

describe("generateResetToken / hashResetToken", () => {
  it("produces a 43-char base64url token (32 bytes of entropy)", () => {
    const token = generateResetToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateResetToken()));
    expect(seen.size).toBe(500);
  });

  it("is deterministic to hash and does not contain the raw token", () => {
    const token = generateResetToken();
    const hash = hashResetToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashResetToken(token));
    expect(hash).not.toContain(token);
  });

  it("different tokens hash differently", () => {
    expect(hashResetToken(generateResetToken())).not.toBe(hashResetToken(generateResetToken()));
  });
});

describe("isValidResetToken", () => {
  it("accepts a real token", () => {
    expect(isValidResetToken(generateResetToken())).toBe(true);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "short", "x".repeat(44), "a".repeat(42), "../../etc/passwd", "a".repeat(43) + "!", null, 123, {}]) {
      expect(isValidResetToken(bad)).toBe(false);
    }
  });
});

describe("buildResetUrl", () => {
  // The configured base is read from the environment, so isolate it — otherwise
  // a developer's local APP_URL would silently change what these assert.
  const saved = { app: process.env.APP_URL, publicApp: process.env.NEXT_PUBLIC_APP_URL };
  beforeEach(() => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
  afterAll(() => {
    if (saved.app === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved.app;
    if (saved.publicApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved.publicApp;
  });

  it("builds a reset-password link with the encoded token", () => {
    const url = buildResetUrl("http://localhost:3000", "abc");
    expect(url).toContain("/reset-password?token=abc");
  });

  it("strips a trailing slash from the base", () => {
    expect(buildResetUrl("https://example.com/", "t")).toBe("https://example.com/reset-password?token=t");
  });

  it("percent-encodes a token so it cannot break out of the query", () => {
    const url = buildResetUrl("https://example.com", "a&b=c#d");
    expect(url).toBe("https://example.com/reset-password?token=a%26b%3Dc%23d");
  });

  it("prefers the configured APP_URL over the request origin", () => {
    process.env.APP_URL = "https://kanhagen.vercel.app/";
    expect(buildResetUrl("http://localhost:3000", "tok")).toBe(
      "https://kanhagen.vercel.app/reset-password?token=tok",
    );
  });

  it("falls back to the request origin when APP_URL is unset", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.example.com";
    expect(buildResetUrl("http://localhost:3000", "tok")).toBe(
      "https://fallback.example.com/reset-password?token=tok",
    );
  });

  it("ignores a non-http origin so a forged Host header cannot be mailed out", () => {
    expect(buildResetUrl("javascript:alert(1)", "tok")).toBe("http://localhost:3000/reset-password?token=tok");
  });
});

describe("issuePasswordReset", () => {
  it("stores only the hash, never the raw token", async () => {
    const { db, rows } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    const stored = rows()[0];
    expect(stored.tokenHash).toBe(hashResetToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("expires in one hour", async () => {
    const { db, rows } = makeFakeDb();
    await issuePasswordReset(db, "user-1");
    const expected = rows()[0].createdAt.getTime() + RESET_TTL_MS;
    expect(rows()[0].expiresAt.getTime()).toBe(expected);
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("invalidates the previous token when a new one is issued", async () => {
    const { db } = makeFakeDb();
    const first = await issuePasswordReset(db, "user-1");
    const second = await issuePasswordReset(db, "user-1");

    expect(await consumePasswordReset(db, first)).toBeNull();
    expect(await consumePasswordReset(db, second)).toBe("user-1");
  });

  it("does not touch another user's tokens", async () => {
    const { db } = makeFakeDb();
    const mine = await issuePasswordReset(db, "user-1");
    await issuePasswordReset(db, "user-2");
    expect(await consumePasswordReset(db, mine)).toBe("user-1");
  });
});

describe("consumePasswordReset", () => {
  it("returns the user id for a valid token", async () => {
    const { db } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    expect(await consumePasswordReset(db, token)).toBe("user-1");
  });

  it("is single-use — a replayed token is rejected", async () => {
    const { db } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    expect(await consumePasswordReset(db, token)).toBe("user-1");
    expect(await consumePasswordReset(db, token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { db, rows } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    // Age the row past its TTL.
    rows()[0].expiresAt = new Date(Date.now() - 1000);
    expect(await consumePasswordReset(db, token)).toBeNull();
  });

  it("accepts a token one second before expiry", async () => {
    const { db, rows } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    rows()[0].expiresAt = new Date(Date.now() + 1000);
    expect(await consumePasswordReset(db, token)).toBe("user-1");
  });

  it("rejects an unknown token", async () => {
    const { db } = makeFakeDb();
    expect(await consumePasswordReset(db, generateResetToken())).toBeNull();
  });

  it("rejects a malformed token before touching the database", async () => {
    const { db, count } = makeFakeDb();
    expect(await consumePasswordReset(db, "nope")).toBeNull();
    expect(count()).toBe(0);
  });
});

describe("releasePasswordReset", () => {
  it("makes a consumed token usable again after a failed write", async () => {
    const { db } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");

    expect(await consumePasswordReset(db, token)).toBe("user-1");
    await releasePasswordReset(db, token);
    expect(await consumePasswordReset(db, token)).toBe("user-1");
  });

  it("is a no-op for a token that was never claimed", async () => {
    const { db } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    await releasePasswordReset(db, token);
    expect(await consumePasswordReset(db, token)).toBe("user-1");
  });
});

describe("deletePasswordReset", () => {
  it("removes the row entirely", async () => {
    const { db, count } = makeFakeDb();
    const token = await issuePasswordReset(db, "user-1");
    await deletePasswordReset(db, token);
    expect(count()).toBe(0);
    expect(await consumePasswordReset(db, token)).toBeNull();
  });
});
