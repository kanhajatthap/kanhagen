import { NextResponse } from "next/server";
import { getDb } from "../../../lib/mongodb";
import { checkRateLimit } from "../../../lib/rateLimit";
import { getClientIp } from "../../../lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** createIndex is idempotent but still a round-trip; do it once per process. */
let indexesReady: Promise<unknown> | null = null;

export async function GET(req: Request) {
  // Public, unauthenticated, and unindexed-regex capable: cap the request rate
  // so it can't be used to hammer Mongo.
  const limitResult = checkRateLimit(`explore:${getClientIp(req)}`, 60_000, 60);
  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limitResult.retryAfter ?? 60) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const sort = searchParams.get("sort") || "latest";
  // parseInt yields NaN for junk and a negative number is silently inverted by
  // the driver, so clamp explicitly instead of trusting the parameter.
  const rawLimit = Number.parseInt(searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1;
  const q = (searchParams.get("q") || "").slice(0, 100);
  const skip = (page - 1) * limit;

  try {
    const db = await getDb();
    const collection = db.collection("image_history");
    indexesReady ??= collection
      .createIndex({ createdAt: -1 })
      .then(() => collection.createIndex({ prompt: "text" }))
      .catch((e) => {
        // Don't cache a failure; the next request retries.
        indexesReady = null;
        throw e;
      });
    await indexesReady;

    const query: Record<string, unknown> = {
      mimeType: { $ne: "text/plain" },
      imageBase64: { $exists: true },
      // Explicit opt-in only. `$ne: false` would also match legacy rows that
      // predate the flag and leak private images into the public gallery.
      public: true,
    };

    if (q) {
      // Unindexed $regex = collection scan per request; `q` is length-capped above.
      query.prompt = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    let sortOption: Record<string, 1 | -1> = {};
    switch (sort) {
      case "popular":
        sortOption = { createdAt: -1 };
        break;
      case "random":
        sortOption = { createdAt: -1 };
        break;
      case "latest":
      default:
        sortOption = { createdAt: -1 };
        break;
    }

    const rows = await db
      .collection("image_history")
      .find(query, {
        projection: {
          prompt: 1,
          model: 1,
          mimeType: 1,
          seed: 1,
          width: 1,
          height: 1,
          createdAt: 1,
        },
      })
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .toArray();

    let results = rows;
    if (sort === "random") {
      results = [...rows].sort(() => Math.random() - 0.5);
    }

    const items = results.map((row) => ({
      id: String(row._id),
      prompt: row.prompt,
      model: row.model || "flux",
      mimeType: row.mimeType || "image/png",
      seed: row.seed,
      width: row.width,
      height: row.height,
      createdAt: row.createdAt,
    }));

    return NextResponse.json({ items, page, hasMore: items.length === limit }, { status: 200 });
  } catch (e) {
    console.error("Explore API error:", e);
    return NextResponse.json(
      { error: "Failed to load gallery." },
      { status: 500 }
    );
  }
}
