// Thin server-side Supabase (PostgREST) helper. No SDK dependency: the app only
// needs a few REST calls, and the service-role key must never reach the browser,
// so every function here runs on the server via the Next API routes.
//
// Access model: RLS is on with no anon policies, so the service role (which
// bypasses RLS) is the only way in. Candidate rows carry PII and account rows
// carry live session cookies, so nothing is exposed to the anon key.

const URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Workflow candidate rows are string-keyed with mixed string/number values.
export type CandidateRow = Record<string, unknown>;

export interface RecruiterAccount {
  id: string;
  platform: string;
  label: string;
  cookie: string | null;
  csrf: string | null;
  extra: Record<string, string>;
  active: boolean;
  status: string;
  last_used_at: string | null;
  last_result_count: number | null;
  cookie_updated_at: string | null;
}

// Browser-facing account shape: the live cookie/csrf are stripped, replaced by a
// boolean so the UI can show whether a session is attached without leaking it.
export type AccountSummary = Omit<RecruiterAccount, "cookie" | "csrf"> & {
  hasCookie: boolean;
};

// A candidates-table record, as written by upsertCandidates.
export interface CandidateRecord {
  platform: string;
  candidate_id: string | null;
  dedupe_key: string;
  source_account: string | null;
  name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  match: number | null;
  number: string | null;
  contact_status: string | null;
  profile_link: string | null;
  role: string | null;
  client: string | null;
  sourced_at: string;
  data: CandidateRow;
}

export interface RunRecord {
  platform: string;
  job_title: string;
  client_name: string;
  location: string;
  candidate_count: number;
  revealed_count: number;
  top_candidate: string;
  top_score: number;
  page: number;
  accounts_used: string[];
}

export function isSupabaseConfigured(): boolean {
  return Boolean(URL && SERVICE_KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    "content-type": "application/json",
    ...extra,
  };
}

// One REST round-trip. Returns parsed JSON as unknown; callers assert the shape
// they expect at their own boundary (PostgREST responses are ours to trust).
async function req(path: string, init: RequestInit): Promise<unknown> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  const res = await fetch(`${URL.replace(/\/$/, "")}/rest/v1/${path}`, init);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

// ── recruiter_accounts ──────────────────────────────────────────────────────

export async function listAccounts(platform?: string): Promise<RecruiterAccount[]> {
  const q = new URLSearchParams({ select: "*", order: "label.asc" });
  if (platform) q.set("platform", `eq.${platform}`);
  const rows = await req(`recruiter_accounts?${q}`, { method: "GET", headers: headers() });
  return (rows as RecruiterAccount[]) || [];
}

// Active accounts that actually carry a cookie — the ones a run can fan out to.
export async function activeAccountsWithCookie(platform: string): Promise<RecruiterAccount[]> {
  const all = await listAccounts(platform);
  return all.filter((a) => a.active && a.cookie && a.cookie.trim());
}

export async function upsertAccountCookie(
  platform: string,
  label: string,
  cookie: string,
  csrf: string | null
): Promise<void> {
  const row = {
    platform,
    label,
    cookie,
    csrf,
    status: "unknown",
    cookie_updated_at: new Date().toISOString(),
  };
  await req(`recruiter_accounts?on_conflict=platform,label`, {
    method: "POST",
    headers: headers({ prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row),
  });
}

export async function setAccountActive(id: string, active: boolean): Promise<void> {
  await req(`recruiter_accounts?id=eq.${id}`, {
    method: "PATCH",
    headers: headers({ prefer: "return=minimal" }),
    body: JSON.stringify({ active }),
  });
}

export async function markAccountUsed(
  id: string,
  status: string,
  resultCount: number
): Promise<void> {
  await req(`recruiter_accounts?id=eq.${id}`, {
    method: "PATCH",
    headers: headers({ prefer: "return=minimal" }),
    body: JSON.stringify({
      status,
      last_used_at: new Date().toISOString(),
      last_result_count: resultCount,
    }),
  }).catch(() => undefined);
}

// ── candidates ──────────────────────────────────────────────────────────────

const COL: Record<string, string[]> = {
  candidateId: ["Candidate ID", "CandidateID", "Id"],
  name: ["Name", "Candidate Name", "Full Name"],
  title: ["Title", "Designation", "Current Title"],
  company: ["Company", "Current Company", "Employer"],
  location: ["Location", "City", "Current Location"],
  match: ["Match %", "Match", "Score"],
  number: ["Number", "Phone", "Mobile"],
  contact: ["Contact Status", "Contact?", "Contact"],
  link: ["Profile Link", "Profile URL", "Profile", "Link"],
  role: ["Role"],
  client: ["Client"],
  sourcedAt: ["Sourced At", "SourcedAt", "Date"],
};

function pick(row: CandidateRow, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

// Maps a workflow candidate row to a candidates record. Keeps the full row in
// `data` so nothing is lost and the dashboard can read any column. The dedupe
// key is the Candidate ID, falling back to name|number when a row lacks one.
export function toCandidateRecord(
  platform: string,
  sourceAccount: string,
  row: CandidateRow
): CandidateRecord {
  const cid = pick(row, COL.candidateId);
  const sourcedAtRaw = pick(row, COL.sourcedAt);
  const sourcedAt =
    sourcedAtRaw && !Number.isNaN(Date.parse(sourcedAtRaw))
      ? new Date(sourcedAtRaw).toISOString()
      : new Date().toISOString();
  const matchRaw = Number(pick(row, COL.match));
  return {
    platform,
    candidate_id: cid || null,
    dedupe_key: cid || `${pick(row, COL.name).toLowerCase()}|${pick(row, COL.number)}`,
    source_account: sourceAccount || null,
    name: pick(row, COL.name) || null,
    title: pick(row, COL.title) || null,
    company: pick(row, COL.company) || null,
    location: pick(row, COL.location) || null,
    match: Number.isFinite(matchRaw) ? Math.round(matchRaw) : null,
    number: pick(row, COL.number) || null,
    contact_status: pick(row, COL.contact) || null,
    profile_link: pick(row, COL.link) || null,
    role: pick(row, COL.role) || null,
    client: pick(row, COL.client) || null,
    sourced_at: sourcedAt,
    data: row,
  };
}

// Upsert candidate rows, newest data winning on conflict. Duplicates within the
// batch are collapsed first so PostgREST does not reject the upsert for touching
// one row twice.
export async function upsertCandidates(
  platform: string,
  sourceAccount: string,
  rows: CandidateRow[]
): Promise<number> {
  const byKey = new Map<string, CandidateRecord>();
  for (const r of rows) {
    const rec = toCandidateRecord(platform, sourceAccount, r);
    byKey.set(rec.dedupe_key, rec);
  }
  const unique = Array.from(byKey.values());
  if (!unique.length) return 0;
  await req(`candidates?on_conflict=platform,dedupe_key`, {
    method: "POST",
    headers: headers({ prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(unique),
  });
  return unique.length;
}

interface CandidateReadRow {
  data: CandidateRow | null;
  source_account: string | null;
}

// Read candidates back for the dashboard. Returns the stored `data` blob merged
// with the source account, so the dashboard's column logic works unchanged.
export async function getCandidates(
  platform: string,
  sinceIso?: string
): Promise<CandidateRow[]> {
  const q = new URLSearchParams({
    select: "data,source_account,sourced_at",
    platform: `eq.${platform}`,
    order: "sourced_at.desc",
    limit: "2000",
  });
  if (sinceIso) q.set("sourced_at", `gte.${sinceIso}`);
  const rows = (await req(`candidates?${q}`, { method: "GET", headers: headers() })) as
    | CandidateReadRow[]
    | null;
  return (rows || []).map((r) => ({ ...(r.data || {}), _account: r.source_account || "" }));
}

// ── runs ────────────────────────────────────────────────────────────────────

export async function insertRun(run: RunRecord): Promise<void> {
  await req(`runs`, {
    method: "POST",
    headers: headers({ prefer: "return=minimal" }),
    body: JSON.stringify(run),
  }).catch(() => undefined);
}

export async function listRuns(platform?: string): Promise<Record<string, unknown>[]> {
  const q = new URLSearchParams({ select: "*", order: "created_at.desc", limit: "100" });
  if (platform) q.set("platform", `eq.${platform}`);
  const rows = await req(`runs?${q}`, { method: "GET", headers: headers() });
  return (rows as Record<string, unknown>[]) || [];
}
