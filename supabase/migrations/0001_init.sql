-- JobKreators sourcing console — Supabase schema.
-- Replaces the Google Sheet as the candidate store and adds a multi-account
-- recruiter registry so a run can fan out across every active login of a
-- platform. All app access goes through the Next API using the service-role
-- key (which bypasses RLS); RLS is enabled with no anon policies so the
-- anon key alone can read nothing (candidate rows are PII, cookies are secret).

-- ── recruiter_accounts ──────────────────────────────────────────────────────
-- One row per recruiter login per platform (4 Shine, 5 Foundit, 1 Apna today).
-- `cookie` is the current portal session; it expires in hours and is refreshed
-- from the dashboard. `extra` carries per-platform bits (Apna org/workspace ids).
create table if not exists public.recruiter_accounts (
  id                 uuid primary key default gen_random_uuid(),
  platform           text not null check (platform in ('shine','foundit','apna')),
  label              text not null,                 -- e.g. jobkreators_1
  cookie             text,                          -- session cookie / token
  csrf               text,                          -- derived (shine)
  extra              jsonb not null default '{}'::jsonb,
  active             boolean not null default true, -- include in fan-out
  status             text not null default 'unknown', -- ok | expired | error | unknown
  last_used_at       timestamptz,
  last_result_count  int,
  cookie_updated_at  timestamptz,
  created_at         timestamptz not null default now(),
  unique (platform, label)
);

-- ── candidates ──────────────────────────────────────────────────────────────
-- Cumulative candidate store. Upsert on (platform, dedupe_key) so the same
-- person sourced again (different keyword/account) merges instead of duplicating.
-- `data` holds the full original row exactly as the workflow built it; the
-- flat columns are extracted for dedup, sorting and dashboard display.
create table if not exists public.candidates (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null,
  candidate_id    text,
  dedupe_key      text not null,
  source_account  text,                            -- recruiter login it came from
  name            text,
  title           text,
  company         text,
  location        text,
  match           int,
  number          text,
  contact_status  text,
  profile_link    text,
  role            text,
  client          text,
  sourced_at      timestamptz,
  data            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (platform, dedupe_key)
);
create index if not exists candidates_platform_sourced_idx
  on public.candidates (platform, sourced_at desc);

-- ── runs ────────────────────────────────────────────────────────────────────
-- Run history. Replaces the browser-local jbkfinder.runHistory so history is
-- shared across recruiters instead of per-browser.
create table if not exists public.runs (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null,
  job_title       text,
  client_name     text,
  location        text,
  candidate_count int,
  revealed_count  int,
  top_candidate   text,
  top_score       numeric,
  page            int,
  accounts_used   text[],
  created_at      timestamptz not null default now()
);
create index if not exists runs_created_idx on public.runs (created_at desc);

-- ── RLS: lock everything; only the service role (Next API) may touch data ────
alter table public.recruiter_accounts enable row level security;
alter table public.candidates         enable row level security;
alter table public.runs               enable row level security;
-- No policies for anon/authenticated on purpose. service_role bypasses RLS.
