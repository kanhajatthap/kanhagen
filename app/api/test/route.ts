import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Connectivity check. It is deliberately inert — no DB, no env, no secrets —
 * but it is still an unauthenticated endpoint on the deployed app, so it only
 * answers outside production.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ test: "API working" });
}
