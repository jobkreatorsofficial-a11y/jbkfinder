import { NextRequest, NextResponse } from "next/server";
import { getPlatform, isPlatformId, type PlatformId } from "@/lib/platforms";
import {
  activeAccountsWithCookie,
  insertRun,
  isSupabaseConfigured,
  markAccountUsed,
  upsertCandidates,
  type CandidateRow,
  type RecruiterAccount,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// Runs a sourcing job by fanning out across every active recruiter login of the
// chosen platform. Each login's session cookie lives in Supabase, so one run
// pulls profiles from all of them in parallel, stores the results (attributed to
// the login that sourced them) and returns the merged, scored list to the
// dashboard. The n8n webhook still does the sourcing + scoring per cookie and
// responds inline with a JSON array of candidates.

const BASE_REQUIRED = ["jobTitle", "jobDescription", "clientName", "recipientEmail"];

function resolveWebhook(envName: string, fallbacks: string[] = []): string {
  for (const n of [envName, ...fallbacks]) {
    const v = String(process.env[n] || "").trim();
    if (v) return v;
  }
  return "";
}

// Session credentials for one login, keyed the way each workflow expects them.
function credsForAccount(platform: PlatformId, account: RecruiterAccount): Record<string, string> {
  const cookie = String(account.cookie || "").trim();
  if (platform === "shine") {
    const csrf = String(account.csrf || "").trim() || (cookie.match(/csrftoken=([^;\s]+)/)?.[1] ?? "");
    return { shineCookie: cookie, shineCsrf: csrf };
  }
  if (platform === "foundit") {
    return { founditCookie: cookie };
  }
  // apna
  return {
    apnaAuth: cookie,
    apnaOrgId: String(account.extra?.apnaOrgId || ""),
    apnaWorkspaceId: String(account.extra?.apnaWorkspaceId || ""),
    apnaMemberId: String(account.extra?.apnaMemberId || ""),
  };
}

// Parses one webhook response body into a candidate array. A JSON array is the
// scored list; anything else (ack object, empty, plain text) yields no rows.
// The workflows return a single {_empty:true} sentinel when a search finds
// nothing; those are dropped so an empty search reads as zero candidates.
function parseCandidates(text: string): CandidateRow[] {
  if (!text.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return (parsed as CandidateRow[]).filter(
      (r) => r && typeof r === "object" && r["_empty"] !== true
    );
  } catch {
    return [];
  }
}

interface AccountResult {
  label: string;
  ok: boolean;
  count: number;
  error?: string;
}

// One session to source from: a registry account (id set) or the legacy
// single cookie posted with the request (id null, label "manual").
interface SourcingSession {
  id: string | null;
  label: string;
  creds: Record<string, string>;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const platformId = body?.platform;
  if (!isPlatformId(platformId)) {
    return NextResponse.json(
      { ok: false, error: "Unknown platform. Pick Shine, Foundit or Apna." },
      { status: 400 }
    );
  }
  const platform = getPlatform(platformId);

  const webhookUrl = resolveWebhook(platform.webhookEnv, platform.webhookEnvFallbacks);
  if (!webhookUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: `The ${platform.label} sourcing endpoint is not configured. Set ${platform.webhookEnv}.`,
      },
      { status: 500 }
    );
  }

  // Base run payload (JD + filters), stripped of the routing field.
  const base: Record<string, unknown> = { ...body };
  delete base.platform;

  const missing = BASE_REQUIRED.filter((k) => !String(base[k] ?? "").trim());
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `Fill in these fields first: ${missing.join(", ")}.` },
      { status: 400 }
    );
  }

  // Prefer the recruiter-account registry: if any active login has a stored
  // cookie, fan out across all of them. Otherwise fall back to the single
  // session posted with the request, so the console keeps working before the
  // multi-account registry (Supabase) is set up.
  let accounts: RecruiterAccount[] = [];
  if (isSupabaseConfigured()) {
    try {
      accounts = await activeAccountsWithCookie(platform.id);
    } catch {
      accounts = [];
    }
  }

  let sessions: SourcingSession[];
  if (accounts.length) {
    // Fan-out: credentials come from the registry, not the browser.
    for (const c of platform.credentials) delete base[c.name];
    sessions = accounts.map((a) => ({
      id: a.id,
      label: a.label,
      creds: credsForAccount(platform.id, a),
    }));
  } else {
    // Legacy single session: credentials come with the request.
    const requiredCreds = platform.credentials.filter((c) => c.required).map((c) => c.name);
    const missingCreds = requiredCreds.filter((k) => !String(base[k] ?? "").trim());
    if (missingCreds.length) {
      const labels = missingCreds.map(
        (k) => platform.credentials.find((c) => c.name === k)?.label ?? k
      );
      return NextResponse.json(
        { ok: false, error: `Fill in these fields first: ${labels.join(", ")}.` },
        { status: 400 }
      );
    }
    const creds: Record<string, string> = {};
    for (const c of platform.credentials) creds[c.name] = String(base[c.name] ?? "").trim();
    if (platform.id === "shine" && !creds.shineCsrf) {
      creds.shineCsrf = String(base.shineCookie ?? "").match(/csrftoken=([^;\s]+)/)?.[1] ?? "";
    }
    for (const c of platform.credentials) delete base[c.name];
    sessions = [{ id: null, label: "manual", creds }];
  }

  // Run each session's webhook in parallel. Each call sources + scores for its
  // cookie and returns its own candidate array.
  const settled = await Promise.allSettled(
    sessions.map(async (s) => {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, ...s.creds }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(`${res.status} ${text.slice(0, 120)}`);
      }
      return parseCandidates(text);
    })
  );

  const all: CandidateRow[] = [];
  const perAccount: AccountResult[] = [];
  await Promise.all(
    settled.map(async (outcome, i) => {
      const s = sessions[i];
      if (outcome.status === "fulfilled") {
        const rows = outcome.value;
        all.push(...rows);
        perAccount.push({ label: s.label, ok: true, count: rows.length });
        if (isSupabaseConfigured()) {
          try {
            await upsertCandidates(platform.id, s.label, rows);
          } catch {
            // A storage failure must not lose the candidates already in hand.
          }
        }
        if (s.id) await markAccountUsed(s.id, rows.length ? "ok" : "empty", rows.length);
      } else {
        const error = outcome.reason instanceof Error ? outcome.reason.message : "failed";
        perAccount.push({ label: s.label, ok: false, count: 0, error });
        if (s.id) await markAccountUsed(s.id, "error", 0);
      }
    })
  );

  if (!perAccount.some((r) => r.ok)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Every ${platform.label} session failed. Cookies may have expired — refresh them.`,
        accounts: perAccount,
      },
      { status: 502 }
    );
  }

  // Record the run when Supabase is available (best-effort; the dashboard does
  // the final merge/sort, so top-of-run here is approximate).
  if (isSupabaseConfigured()) {
    const revealed = all.filter((c) => {
      const status = String(c["Contact Status"] ?? "").trim().toLowerCase();
      return status === "revealed" || status === "unlocked" || status === "yes";
    }).length;
    const top = all.reduce<CandidateRow | null>((best, c) => {
      const m = Number(c["Match %"] ?? c["Match"] ?? 0);
      const bm = best ? Number(best["Match %"] ?? best["Match"] ?? 0) : -1;
      return m > bm ? c : best;
    }, null);
    await insertRun({
      platform: platform.id,
      job_title: String(base.jobTitle ?? ""),
      client_name: String(base.clientName ?? ""),
      location: String(base.location ?? ""),
      candidate_count: all.length,
      revealed_count: revealed,
      top_candidate: top ? String(top["Name"] ?? "") : "",
      top_score: top ? Number(top["Match %"] ?? top["Match"] ?? 0) : 0,
      page: Number(base.page ?? 1) || 1,
      accounts_used: perAccount.filter((r) => r.ok).map((r) => r.label),
      candidates: all.slice(0, 300),
    });
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    platform: platform.id,
    accounts: perAccount,
    candidates: all,
  });
}
