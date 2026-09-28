import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../../../lib/mongodb";
import { deriveImageMime } from "../../../lib/imageMime";
import { MAX_PROMPT_CHARS, MAX_UPLOAD_BYTES } from "../../../lib/chat/common";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 60;

async function getSessionUserId() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;
  return session?.userId || null;
}

export async function GET(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const skip = (page - 1) * limit;

  const db = await getDb();
  const collection = db.collection("image_history");
  await collection.createIndex({ userId: 1, createdAt: -1 });

  // Return history items (images, text, and vision). The base64 payload is
  // deliberately NOT included — the client loads bytes from
  // /api/history/:id/image on demand. Shipping every image inline made this
  // response megabytes large (the 8s page loads).
  type HistoryRow = {
    _id: import("mongodb").ObjectId;
    prompt?: string;
    title?: string;
    pinned?: boolean;
    model?: string;
    mimeType?: string;
    createdAt?: Date;
    updatedAt?: Date;
    conversationId?: string;
    type?: string;
    generatedText?: string;
    public?: boolean;
  };

  // Fetch one extra row to learn whether another page exists.
  const rows = (await collection
    .find({ userId }, { projection: { prompt: 1, title: 1, pinned: 1, model: 1, mimeType: 1, createdAt: 1, updatedAt: 1, type: 1, generatedText: 1, conversationId: 1, public: 1 } })
    .sort({ createdAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit + 1)
    .toArray()) as unknown as HistoryRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items = pageRows.map((row) => ({
    id: String(row._id),
    prompt: row.prompt,
    title: row.title,
    pinned: !!row.pinned,
    model: row.model,
    mimeType: row.mimeType || "image/png",
    public: row.public === true,
    createdAt: row.createdAt,
    imageUrl: `/api/history/${row._id}/image`,
  }));

  // Conversations are aggregated separately from the paged items. Deriving them
  // from the current page would split a chat whose messages straddle a page
  // boundary, and would hide older chats from the sidebar entirely.
  type ConversationDoc = {
    _id: string;
    title?: string;
    pinned?: boolean;
    model?: string;
    mimeType?: string;
    type?: string;
    prompt?: string;
    createdAt?: Date;
    updatedAt?: Date;
    messageCount?: number;
  };

  const MAX_CONVERSATIONS = 200;
  const convRows = (await collection
    .aggregate<ConversationDoc>([
      { $match: { userId } },
      {
        $group: {
          // Legacy docs (no conversationId) are their own conversation.
          _id: { $ifNull: ["$conversationId", { $toString: "$_id" }] },
          title: { $last: "$title" },
          pinned: { $last: "$pinned" },
          model: { $last: "$model" },
          mimeType: { $last: "$mimeType" },
          type: { $last: "$type" },
          prompt: { $last: "$prompt" },
          createdAt: { $min: "$createdAt" },
          updatedAt: { $max: "$updatedAt" },
          messageCount: { $sum: 1 },
        },
      },
      { $sort: { updatedAt: -1, createdAt: -1 } },
      { $limit: MAX_CONVERSATIONS },
    ])
    .toArray()) as unknown as ConversationDoc[];

  const conversations = convRows.map((c) => ({
    id: c._id,
    prompt: c.prompt || "Untitled",
    ...(c.title ? { title: c.title } : {}),
    pinned: !!c.pinned,
    model: c.model,
    mimeType: c.mimeType || "image/png",
    type: c.type,
    messageCount: c.messageCount ?? 1,
    createdAt: (c.createdAt ? new Date(c.createdAt) : new Date(0)).toISOString(),
    updatedAt: (c.updatedAt ? new Date(c.updatedAt) : new Date(0)).toISOString(),
  }));

  conversations.sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return NextResponse.json({ items, conversations, page, limit, hasMore }, { status: 200 });
}

export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
  const model = typeof body?.model === "string" ? body.model : "unknown";

  if (!prompt || !imageBase64) {
    return NextResponse.json({ error: "Missing prompt or imageBase64." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: `Prompt too long. Maximum ${MAX_PROMPT_CHARS} characters.` }, { status: 400 });
  }

  // Decoded size is checked against the same cap as uploads, since base64
  // inflates by ~4/3 and this endpoint writes the bytes straight to Mongo.
  const bytes = Buffer.from(imageBase64, "base64");
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Invalid image data." }, { status: 400 });
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image too large." }, { status: 413 });
  }

  // The client's `mimeType` is ignored on purpose — it is used verbatim as a
  // `Content-Type` response header when the image is served back, so a stored
  // `text/html` would be a stored XSS on this origin. The real type comes from
  // the image's magic bytes.
  const mimeType = deriveImageMime(bytes);

  const db = await getDb();
  const inserted = await db.collection("image_history").insertOne({
    userId,
    prompt,
    model,
    mimeType,
    imageBase64,
    createdAt: new Date(),
  });

  return NextResponse.json({ id: String(inserted.insertedId) }, { status: 201 });
}

export async function DELETE(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const id = typeof body?.id === "string" ? body.id : "";

  const db = await getDb();
  const collection = db.collection("image_history");

  // Deleting a conversation removes its first message and every follow-up turn.
  if (conversationId) {
    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }

    const result = await collection.deleteMany({
      userId,
      $or: [{ _id: new ObjectId(conversationId) }, { conversationId }],
    });

    if (!result.deletedCount) {
      return NextResponse.json({ error: "History item not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  }

  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid history id." }, { status: 400 });
  }

  const result = await collection.deleteOne({
    _id: new ObjectId(id),
    userId,
  });

  if (!result.deletedCount) {
    return NextResponse.json({ error: "History item not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}

export async function PATCH(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const title = typeof body?.title === "string" ? body.title.trim() : null;
  const pinned = typeof body?.pinned === "boolean" ? body.pinned : null;

  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid history id." }, { status: 400 });
  }

  if (title === null && pinned === null) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== null) $set.title = title;
  if (pinned !== null) $set.pinned = pinned;

  const db = await getDb();
  const result = await db.collection("image_history").updateOne(
    { _id: new ObjectId(id), userId },
    { $set },
  );

  if (!result.matchedCount) {
    return NextResponse.json({ error: "History item not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
