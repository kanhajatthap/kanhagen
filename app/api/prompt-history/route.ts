import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../../../lib/mongodb";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;

  if (!session?.userId) {
    return NextResponse.json({ prompts: [] }, { status: 200 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").slice(0, 100);
  // parseInt returns NaN for junk, and a negative limit reaches Mongo as an
  // inverted absolute value — both need rejecting before they hit the driver.
  const rawLimit = Number.parseInt(searchParams.get("limit") || "10", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 20) : 10;

  const db = await getDb();
  const collection = db.collection("image_history");

  const match: Record<string, unknown> = { userId: session.userId };
  if (q) {
    // An unindexed $regex is a collection scan, so cap the work per request and
    // keep the untrusted string from being an unbounded pattern.
    match.prompt = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  const rows = await collection
    .aggregate([
      { $match: match },
      { $group: { _id: "$prompt", lastUsed: { $max: "$createdAt" } } },
      { $sort: { lastUsed: -1 } },
      { $limit: limit },
      { $project: { _id: 0, prompt: "$_id", lastUsed: 1 } },
    ])
    .toArray();

  return NextResponse.json(
    { prompts: rows.map((r) => r.prompt) },
    { status: 200 }
  );
}
