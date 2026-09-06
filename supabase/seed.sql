-- Seed the recruiter logins the recruiter will attach cookies to later.
-- Cookies are left null; they are filled from the dashboard per session.
insert into public.recruiter_accounts (platform, label, active) values
  ('shine',   'jobkreators',          true),
  ('shine',   'jobkreators_1',        true),
  ('shine',   'jobkreators_2',        true),
  ('shine',   'jobkreators_3',        true),
  ('foundit', 'xAkarsh_Sharmainx01',  true),
  ('foundit', 'xAkarsh_Sharmainx02',  true),
  ('foundit', 'xAkarsh_Sharmainx03',  true),
  ('foundit', 'xAkarsh_Sharmainx04',  true),
  ('foundit', 'xAkarsh_Sharmainx05',  true)
on conflict (platform, label) do nothing;

-- Apna stays single-account for now. Its org/workspace ids live in `extra`.
insert into public.recruiter_accounts (platform, label, active, extra) values
  ('apna', 'apna_primary', true,
   '{"apnaOrgId":"1954756","apnaWorkspaceId":"6a3bd9bf21d89d2fd628341b"}'::jsonb)
on conflict (platform, label) do nothing;
