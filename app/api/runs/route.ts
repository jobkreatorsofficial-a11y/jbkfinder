import { NextRequest, NextResponse } from "next/server";
import {
  getRunCandidates,
  insertRun,
  isSupabaseConfigured,
  listRuns,
  type CandidateRow,
} from "@/lib/supabase";
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

// Records ONE run from the client after a (possibly multi-page) fetch, so a
// 150-candidate run that spanned several page calls logs a single merged entry.
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true, configured: false });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const platform = body.platform;
  if (!isPlatformId(platform)) {
    return NextResponse.json({ ok: false, error: "Unknown platform." }, { status: 400 });
  }
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []) as CandidateRow[];
  const revealed = candidates.filter((c) => {
    const s = String(c["Contact Status"] ?? "").trim().toLowerCase();
    return s === "revealed" || s === "unlocked" || s === "yes";
  }).length;
  const top = candidates.reduce<CandidateRow | null>((best, c) => {
    const m = Number(c["Match %"] ?? c["Match"] ?? 0);
    const bm = best ? Number(best["Match %"] ?? best["Match"] ?? 0) : -1;
    return m > bm ? c : best;
  }, null);
  try {
    await insertRun({
      platform,
      job_title: String(body.jobTitle ?? ""),
      client_name: String(body.clientName ?? ""),
      location: String(body.location ?? ""),
      candidate_count: candidates.length,
      revealed_count: revealed,
      top_candidate: top ? String(top["Name"] ?? "") : "",
      top_score: top ? Number(top["Match %"] ?? top["Match"] ?? 0) : 0,
      page: Number(body.page ?? 1) || 1,
      accounts_used: Array.isArray(body.accountsUsed) ? (body.accountsUsed as string[]) : [],
      candidates: candidates.slice(0, 300),
      status: "ok",
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not record run.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
