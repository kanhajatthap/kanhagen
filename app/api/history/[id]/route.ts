import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/mongodb";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../../lib/session";

export const runtime = "nodejs";

async function getSessionUserId() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;
  return session?.userId || null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  try {
    const db = await getDb();
    const collection = db.collection("image_history");

    // Every query is scoped by `userId`, so another user's id 404s here.
    const requested = await collection.findOne({ _id: new ObjectId(id), userId });
    if (!requested) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // Resolve to the canonical conversation id. The requested doc may be a
    // follow-up turn (child) whose conversationId points to the first message.
    const conversationId =
      typeof requested.conversationId === "string" && requested.conversationId
        ? requested.conversationId
        : String(requested._id);

    // A legacy/corrupt conversationId would make `new ObjectId()` throw and turn
    // into an unhandled 500, so fall back to the doc's own id.
    const rootFilter = ObjectId.isValid(conversationId)
      ? { _id: new ObjectId(conversationId) }
      : { _id: new ObjectId(id) };

    const docs = await collection
      .find({
        userId,
        $or: [rootFilter, { conversationId }],
      })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();

  const root = docs.find((d) => String(d._id) === conversationId) || docs[0] || requested;

  const turns = docs.map((d) => {
    const docId = String(d._id);
    const created = d.createdAt instanceof Date ? d.createdAt : new Date();

    if (d.type === "batch") {
      const count = Array.isArray(d.batchResults) ? d.batchResults.length : 0;
      return {
        id: docId,
        prompt: d.prompt || "Batch generation",
        type: "batch",
        mimeType: d.mimeType || "image/png",
        imageUrl: `/api/history/${docId}/image`,
        variations: Array.from({ length: count }, (_, i) => ({
          id: `${docId}-${i}`,
          url: `/api/history/${docId}/image?n=${i}`,
          seed: (d.batchResults?.[i] as { seed?: number } | undefined)?.seed || 0,
          prompt: d.prompt || "",
        })),
        createdAt: created.toISOString(),
      };
    }

    if (d.mimeType === "text/plain") {
      return {
        id: docId,
        prompt: d.prompt || "",
        type: "text",
        mimeType: "text/plain",
        generatedText: d.generatedText || "",
        createdAt: created.toISOString(),
      };
    }

    if (d.type === "vision") {
      return {
        id: docId,
        prompt: d.prompt || "",
        type: "vision",
        mimeType: d.mimeType,
        response: d.response || d.generatedText || "",
        createdAt: created.toISOString(),
      };
    }

    return {
      id: docId,
      prompt: d.prompt || "",
      type: "image",
      mimeType: d.mimeType || "image/png",
      imageUrl: `/api/history/${docId}/image`,
      createdAt: created.toISOString(),
    };
  });

  return NextResponse.json(
    {
      conversationId,
      item: {
        id: String(root._id),
        prompt: root.prompt,
        title: root.title,
        pinned: !!root.pinned,
        model: root.model,
        mimeType: root.mimeType || "image/png",
        type: root.type,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
      },
      items: turns,
    },
    { status: 200 },
  );
  } catch (e) {
    console.error("History conversation API error:", e);
    return NextResponse.json({ error: "Failed to load conversation." }, { status: 500 });
  }
}
