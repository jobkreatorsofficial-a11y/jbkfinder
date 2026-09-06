import { NextRequest, NextResponse } from "next/server";
import { getRunCandidates, isSupabaseConfigured, listRuns } from "@/lib/supabase";
import { isPlatformId } from "@/lib/platforms";

export const runtime = "nodejs";

// Run history, shared across recruiters via Supabase (replaces the per-browser
// localStorage history). Newest first, capped in the query.

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, configured: false, runs: [] });
  }
  // ?id=<run> returns that run's candidate snapshot; otherwise the run list.
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    try {
      const candidates = await getRunCandidates(id);
      return NextResponse.json({ ok: true, candidates });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not read run candidates.";
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
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
