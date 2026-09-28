import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { IMAGE_CREDITS_PER_DAY, TEXT_CREDITS_PER_DAY, quotaDay, getQuotaReset, spendQuota, refundQuota, getQuotaState, getQuotaOverview, quotaExceededMessage, QuotaExceededError } from "../lib/quota";
import type { QuotaState } from "../lib/quota";

/**
 * Minimal in-memory Mongo replacement so quota logic can be tested without a
 * live database. Implements just the calls lib/quota makes (quotas collection:
 * createIndex / findOneAndUpdate / updateOne).
 */
function makeFakeDb() {
  const quotas = new Map<string, { _id: ObjectId; userId: string; day: string; images: number; text: number }>();
  const users = new Map<string, Record<string, unknown>>();

  const collection = (name: string) => {
    if (name === "users") {
      return {
        createIndex: async () => undefined,
        findOne: async (filter: unknown) => users.get((filter as { userId?: string }).userId ?? ""),
        updateOne: async (filter: unknown, update: unknown) => {
          const doc = users.get((filter as { _id: { toString(): string } })?._id?.toString() ?? "");
          if (!doc) return {};
          const $set = (update as { $set?: Record<string, unknown> })?.$set;
          if ($set) Object.assign(doc, $set);
          return {};
        },
      };
    }
    return {
      createIndex: async () => undefined,
      findOne: async (filter: { userId: string; day?: string }) => {
        if (!filter.day) return null;
        return quotas.get(`${filter.userId}|${filter.day}`) ?? null;
      },
      findOneAndUpdate: async (filter: { userId: string; day: string }, update: { $inc: Record<string, number> }, opts: { upsert: boolean; returnDocument: string }) => {
        const key = `${filter.userId}|${filter.day}`;
        let doc = quotas.get(key);
        if (!doc) {
          doc = { _id: new ObjectId(), userId: filter.userId, day: filter.day, images: 0, text: 0 };
          quotas.set(key, doc);
        }
        for (const [field, delta] of Object.entries(update.$inc)) {
          (doc as unknown as Record<string, number>)[field] += delta;
        }
        return opts.returnDocument === "after" ? doc : null;
      },
      updateOne: async (
        filter: { userId: string; day: string; [key: string]: unknown },
        update: { $inc?: Record<string, number>; $set?: Record<string, number> },
      ) => {
        const doc = quotas.get(`${filter.userId}|${filter.day}`);
        if (!doc) return {};
        // Support the `{ field: { $lt: n } }` guard lib/quota uses when
        // clamping a refund at zero.
        for (const [field, cond] of Object.entries(filter)) {
          if (field === "userId" || field === "day") continue;
          const test = cond as { $lt: number };
          if (test && typeof test.$lt === "number") {
            if (!((doc as unknown as Record<string, number>)[field] < test.$lt)) return {};
          }
        }
        if (update.$inc) {
          for (const [field, delta] of Object.entries(update.$inc)) {
            (doc as unknown as Record<string, number>)[field] += delta;
          }
        }
        if (update.$set) {
          for (const [field, value] of Object.entries(update.$set)) {
            (doc as unknown as Record<string, number>)[field] = value;
          }
        }
        return {};
      },
    };
  };

  const db = {
    collection,
  };

  const usersCollection = db.collection("users") as unknown as { createIndex: () => Promise<void>; findOne: (f: unknown) => Promise<unknown>; updateOne: (f: unknown, u: unknown) => Promise<unknown> };
  return {
    db: db as unknown as Db,
    seedUser(userId: string, memory: string[] = []) {
      users.set(userId, { _id: new ObjectId(), memory });
    },
    usersCollection,
  };
}

describe("quotaDay", () => {
  it("returns the UTC calendar day", () => {
    expect(quotaDay(new Date("2026-09-25T18:00:00Z"))).toBe("2026-09-25");
    expect(quotaDay(new Date("2026-09-26T00:00:00Z"))).toBe("2026-09-26");
  });
});

describe("getQuotaReset", () => {
  it("resets at midnight UTC (5:30 AM IST) the next day", () => {
    const reset = getQuotaReset(new Date("2026-09-25T14:00:00Z"));
    expect(reset.day).toBe("2026-09-25");
    expect(new Date(reset.resetAtMs).toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(reset.resetLabel).toContain("5:30");
  });
});

describe("spendQuota", () => {
  it("allows exactly IMAGE_CREDITS_PER_DAY image spends then throws", async () => {
    const { db } = makeFakeDb();
    let state!: QuotaState;
    for (let i = 0; i < IMAGE_CREDITS_PER_DAY; i++) {
      state = (await spendQuota(db, "user-1", "image"))!;
    }
    expect(state.remaining).toBe(0);
    await expect(spendQuota(db, "user-1", "image")).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("refunds the overspend so later getQuotaState reports the exact limit used", async () => {
    const { db } = makeFakeDb();
    for (let i = 0; i < IMAGE_CREDITS_PER_DAY; i++) {
      await spendQuota(db, "user-x", "image");
    }
    await expect(spendQuota(db, "user-x", "image")).rejects.toBeInstanceOf(QuotaExceededError);
    const state = await getQuotaState(db, "user-x", "image");
    expect(state.used).toBe(IMAGE_CREDITS_PER_DAY);
    expect(state.remaining).toBe(0);
  });

  it("each user has an independent image bucket", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-a", "image");
    const stateB = await getQuotaState(db, "user-b", "image");
    expect(stateB.used).toBe(0);
  });

  it("text bucket is larger than the image bucket", async () => {
    const { db } = makeFakeDb();
    let state!: QuotaState;
    for (let i = 0; i < TEXT_CREDITS_PER_DAY; i++) {
      state = (await spendQuota(db, "user-text", "text"))!;
    }
    expect(state.remaining).toBe(0);
    expect(TEXT_CREDITS_PER_DAY).toBeGreaterThan(IMAGE_CREDITS_PER_DAY);
    await expect(spendQuota(db, "user-text", "text")).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("image and text buckets are tracked separately", async () => {
    const { db } = makeFakeDb();
    for (let i = 0; i < IMAGE_CREDITS_PER_DAY; i++) {
      await spendQuota(db, "user-sep", "image");
    }
    const textState = await getQuotaState(db, "user-sep", "text");
    expect(textState.used).toBe(0);
  });

  it("a text spend does not corrupt the image bucket (keeps used 0 / full remaining)", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-partial", "text");
    const imageState = await getQuotaState(db, "user-partial", "image");
    expect(imageState.used).toBe(0);
    expect(imageState.remaining).toBe(IMAGE_CREDITS_PER_DAY);
  });
});

describe("refundQuota", () => {
  it("gives back a charged credit after a provider failure", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-r1", "image");
    expect((await getQuotaState(db, "user-r1", "image")).remaining).toBe(IMAGE_CREDITS_PER_DAY - 1);

    const after = await refundQuota(db, "user-r1", "image");
    expect(after.used).toBe(0);
    expect(after.remaining).toBe(IMAGE_CREDITS_PER_DAY);
  });

  it("refunds a whole batch at once", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-r2", "image", 3);
    const after = await refundQuota(db, "user-r2", "image", 3);
    expect(after.used).toBe(0);
  });

  it("never lets the bucket go negative on a double refund", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-r3", "image");
    await refundQuota(db, "user-r3", "image");
    // A second refund for work that was never charged must not mint credits.
    const after = await refundQuota(db, "user-r3", "image");
    expect(after.used).toBe(0);
    expect(after.remaining).toBe(IMAGE_CREDITS_PER_DAY);
  });

  it("ignores a non-positive amount", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-r4", "image");
    const after = await refundQuota(db, "user-r4", "image", 0);
    expect(after.used).toBe(1);
    const afterNeg = await refundQuota(db, "user-r4", "image", -5);
    expect(afterNeg.used).toBe(1);
  });

  it("refunds text without touching the image bucket", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-r5", "text", 2);
    await refundQuota(db, "user-r5", "text", 2);
    expect((await getQuotaState(db, "user-r5", "text")).used).toBe(0);
    expect((await getQuotaState(db, "user-r5", "image")).used).toBe(0);
  });

  it("frees the user to generate again after a failure", async () => {
    const { db } = makeFakeDb();
    for (let i = 0; i < IMAGE_CREDITS_PER_DAY; i++) {
      await spendQuota(db, "user-r6", "image");
    }
    expect((await getQuotaState(db, "user-r6", "image")).remaining).toBe(0);
    // The last generation failed, so its credit comes back.
    await refundQuota(db, "user-r6", "image");
    const retried = await spendQuota(db, "user-r6", "image");
    expect(retried.remaining).toBe(0);
  });
});

describe("getQuotaOverview", () => {
  it("returns both buckets plus reset info", async () => {
    const { db } = makeFakeDb();
    await spendQuota(db, "user-ov", "image");
    const overview = await getQuotaOverview(db, "user-ov");
    expect(overview.image.remaining).toBe(IMAGE_CREDITS_PER_DAY - 1);
    expect(overview.text.used).toBe(0);
    expect(typeof overview.resetLabel).toBe("string");
    expect(overview.resetLabel.length).toBeGreaterThan(0);
  });
});

describe("quotaExceededMessage", () => {
  it("includes the exact refill date+time", async () => {
    const { db } = makeFakeDb();
    for (let i = 0; i < IMAGE_CREDITS_PER_DAY; i++) {
      await spendQuota(db, "user-msg", "image");
    }
    try {
      await spendQuota(db, "user-msg", "image");
    } catch (e) {
      const err = e as QuotaExceededError;
      const message = quotaExceededMessage(err.state.kind, err.state.resetLabel);
      expect(message).toContain("khatam");
      expect(message).toContain(err.state.resetLabel);
      expect(message).toContain("IST");
    }
  });
});
