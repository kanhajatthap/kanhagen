import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../lib/mongodb";
import { safeResponseImageMime } from "../../../../../lib/imageMime";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../../../lib/session";

export const runtime = "nodejs";

async function getSessionUserId() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;
  return session?.userId || null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();

  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const db = await getDb();
  const row = await db.collection("image_history").findOne(
    { _id: new ObjectId(id) },
    { projection: { imageBase64: 1, mimeType: 1, userId: 1, public: 1, type: 1, batchResults: 1 } },
  );

  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Owner always sees their own images. Everyone else only sees images that
  // were explicitly published. `row.public === true` (not `!== false`) so rows
  // written before the flag existed stay private instead of leaking to /api/explore.
  const isOwner = Boolean(userId && row.userId === userId);
  const viewable = isOwner || row.public === true;
  if (!viewable) return NextResponse.json({ error: "Not found." }, { status: 404 });


  // ?n=N serves the Nth image of a batch generation.
  const indexParam = new URL(req.url).searchParams.get("n");
  const batchResults = row.batchResults as Array<{ imageBase64?: string; mimeType?: string }> | undefined;

  let bytes: ReturnType<typeof Buffer.from>;
  let mimeType: string;
  if (indexParam !== null && indexParam !== "" && Array.isArray(batchResults) && batchResults[parseInt(indexParam, 10)]) {
    const pick = batchResults[parseInt(indexParam, 10)];
    bytes = Buffer.from(pick.imageBase64 || "", "base64");
    mimeType = pick.mimeType || row.mimeType || "image/png";
  } else {
    bytes = Buffer.from(row.imageBase64 || "", "base64");
    mimeType = row.mimeType || "image/png";
  }

  if (bytes.length === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // The stored mimeType is attacker-influenceable: POST /api/history takes it
  // from the request body, and providers can return an arbitrary content-type
  // header. Re-check it against a strict allowlist here so a row written as
  // `text/html` (or `image/svg+xml`, which also runs script) can only ever be
  // served as a real image type. `nosniff` stops the browser from sniffing its
  // way back to the dangerous type.
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": safeResponseImageMime(mimeType),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
    },
  });
}

