import { NextRequest, NextResponse } from "next/server";
import {
  isSupabaseConfigured,
  listAccounts,
  setAccountActive,
  upsertAccountCookie,
  type AccountSummary,
} from "@/lib/supabase";
import { isPlatformId } from "@/lib/platforms";

export const runtime = "nodejs";

// Recruiter account registry. The dashboard uses this to attach a fresh session
// cookie to each portal login and to toggle which logins a run fans out to.
// Cookies live only in Supabase behind the service role; they are never returned
// to the browser (the summary reports hasCookie instead).

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  const platform = req.nextUrl.searchParams.get("platform") ?? undefined;
  try {
    const accounts = await listAccounts(platform && isPlatformId(platform) ? platform : undefined);
    const summaries: AccountSummary[] = accounts.map(({ cookie, csrf, ...rest }) => ({
      ...rest,
      hasCookie: Boolean(cookie && cookie.trim()),
    }));
    return NextResponse.json({ ok: true, accounts: summaries });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not read accounts.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const platform = body.platform;
  const label = String(body.label ?? "").trim();
  const cookie = String(body.cookie ?? "").trim();
  if (!isPlatformId(platform)) {
    return NextResponse.json({ ok: false, error: "Unknown platform." }, { status: 400 });
  }
  if (!label || !cookie) {
    return NextResponse.json(
      { ok: false, error: "label and cookie are both required." },
      { status: 400 }
    );
  }

  // Shine derives its csrf token from the cookie, mirroring the run flow.
  let csrf: string | null = null;
  if (platform === "shine") {
    const m = cookie.match(/csrftoken=([^;\s]+)/);
    csrf = m ? m[1] : null;
  }

  try {
    await upsertAccountCookie(platform, label, cookie, csrf);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not save the cookie.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
  }
  try {
    await setAccountActive(id, Boolean(body.active));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Could not update the account.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
