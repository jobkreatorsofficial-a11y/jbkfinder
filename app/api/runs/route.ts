import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, listRuns } from "@/lib/supabase";
import { isPlatformId } from "@/lib/platforms";

export const runtime = "nodejs";

// Run history, shared across recruiters via Supabase (replaces the per-browser
// localStorage history). Newest first, capped in the query.

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, configured: false, runs: [] });
  }
  const platform = req.nextUrl.searchParams.get("platform");
  try {
    const runs = await listRuns(platform && isPlatformId(platform) ? platform : undefined);
    return NextResponse.json({ ok: true, configured: true, runs });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not read run history.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
