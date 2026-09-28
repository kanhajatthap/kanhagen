import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "../../../lib/mongodb";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session";
import {
  addUserMemoryFacts,
  getUserMemory,
  MAX_MEMORY_FACTS,
  removeUserMemoryFact,
} from "../../../lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserIdFromSession(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;
  return session?.userId || null;
}

// List the current user's assistant memory.
export async function GET() {
  const userId = await getUserIdFromSession();
  if (!userId) return NextResponse.json({ error: "Please login to view memory." }, { status: 401 });

  const db = await getDb();
  const memory = await getUserMemory(db, userId);
  return NextResponse.json({ memory });
}

// Add a memory fact (deduped, capped).
export async function POST(req: Request) {
  const userId = await getUserIdFromSession();
  if (!userId) return NextResponse.json({ error: "Please login to save memory." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const fact = typeof body?.fact === "string" ? body.fact.trim() : "";
  if (!fact) return NextResponse.json({ error: "Empty fact." }, { status: 400 });
  if (fact.length > 500) return NextResponse.json({ error: "Fact is too long (max 500 chars)." }, { status: 400 });

  const db = await getDb();
  const memory = await addUserMemoryFacts(db, userId, [fact]);
  return NextResponse.json({ memory, limit: MAX_MEMORY_FACTS });
}

// Remove a memory fact (case-insensitive).
export async function DELETE(req: Request) {
  const userId = await getUserIdFromSession();
  if (!userId) return NextResponse.json({ error: "Please login to edit memory." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const fact = typeof body?.fact === "string" ? body.fact.trim() : "";
  if (!fact) return NextResponse.json({ error: "Empty fact." }, { status: 400 });
  // Same bound as POST so DELETE can't push an unbounded string through.
  if (fact.length > 500) return NextResponse.json({ error: "Fact is too long (max 500 chars)." }, { status: 400 });

  const db = await getDb();
  const memory = await removeUserMemoryFact(db, userId, fact);
  return NextResponse.json({ memory });
}
