-- Store the exact candidates each run returned, so a past run can be reopened
-- from the dashboard showing precisely what it found. Older runs keep null and
-- fall back to a time-window query.
alter table public.runs add column if not exists candidates jsonb;
