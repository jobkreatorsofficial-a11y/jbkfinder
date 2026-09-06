import { NextRequest, NextResponse } from "next/server";
import { getCandidates, isSupabaseConfigured } from "@/lib/supabase";
import { getPlatform } from "@/lib/platforms";

export const runtime = "nodejs";

// Reads stored candidates for a platform from Supabase. Candidates now arrive on
// the source fan-out response, so this backs the initial load and any refresh.
// `configured` tells the dashboard whether an empty list means "nothing stored"
// or "Supabase is not wired up", so it never clears candidates the run returned.

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // fall through with empty body
  }

  const platform = getPlatform(req.nextUrl.searchParams.get("platform") ?? body?.platform);
  const since = typeof body?.since === "string" ? body.since : undefined;

  try {
    const candidates = await getCandidates(platform.id, since);
    return NextResponse.json({
      ok: true,
      platform: platform.id,
      configured: isSupabaseConfigured(),
      candidates,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { ok: false, error: msg || "Could not read candidates." },
      { status: 500 }
    );
  }
}
