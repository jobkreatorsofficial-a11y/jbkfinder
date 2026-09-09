-- Record the outcome of every run, including failures, so a run that fails
-- (e.g. an expired cookie) no longer silently disappears from history.
alter table public.runs add column if not exists status text not null default 'ok';
alter table public.runs add column if not exists note text;
