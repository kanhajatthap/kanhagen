import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "../../../lib/mongodb";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../../../lib/session";
import { getQuotaOverview } from "../../../lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await verifySessionToken(sessionToken) : null;

  if (!session?.userId) {
    return NextResponse.json({ error: "Please login." }, { status: 401 });
  }

  try {
    const db = await getDb();
    const overview = await getQuotaOverview(db, session.userId);
    return NextResponse.json(overview, { status: 200 });
  } catch (error) {
    console.error("Quota API error:", error);
    return NextResponse.json({ error: "Failed to load quota." }, { status: 500 });
  }
}
