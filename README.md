# JobKreators Sourcing Console (jbkfinder)

A Next.js dashboard that drives the n8n candidate-sourcing workflows. The
webhooks hold the connection open until the run finishes and return the scored
candidates in the response, so the table fills straight from the run. Three
platforms live in separate tabs: **Shine**, **Foundit** and **Apna**.

Left panel: platform tabs, JD in (paste or PDF), skills, location priority,
the filters that platform actually supports, count, client, notify email, sheet
URL, and the per-run credentials for that portal. Right panel: ranked
candidates with match bars, copy-number buttons, and a run history tab that can
be filtered by platform.

Each tab keeps its own form state, its own results, and its own poll timer. You
can fire a Shine run, switch to Apna while it polls, and come back to find
Shine's results waiting.

---

## Platforms

| Platform | Sheet tab | Filters wired | Phone numbers |
| --- | --- | --- | --- |
| Shine | `Shine.csv` | experience, package, age, strict location, keyword | direct |
| Foundit | `Foundit` | experience, package, age, strict location, page, reveal count | top N revealed with credits, rest masked |
| Apna | `Apna` | experience, package, age, strict location, keyword, page | not in search results, paid unlock |

Where pagination is wired, the **Page** field steps up by itself after each run,
and every Candidate ID already pulled this session goes out as `excludeIds`, so
a repeat run never returns the same person.

Run history is stored in the browser under `jbkfinder.runHistory`, capped at 100
entries. It is per-browser, not shared, and **Clear history** wipes it.

Adding a fourth platform is one object literal in `lib/platforms.ts`. The form
fields, payload keys, webhook lookup, results tab and phone-availability notice
all read from that registry.

## 1. Push to GitHub

From the folder that contains this README:

```bash
git init
git add .
git commit -m "JobKreators sourcing console"
git branch -M main
git remote add origin https://github.com/jobkreatorsofficial-a11y/jbkfinder.git
git push -u origin main
```

`node_modules`, `.next` and `.env.local` are already covered by `.gitignore`.

## 2. Google service account (read access to the sheet)

The dashboard reads the sheet directly, so it needs its own read-only identity.
n8n keeps using your existing OAuth credential for writing. Nothing changes there.

1. Google Cloud Console, pick or create a project.
2. APIs and Services, Library, enable **Google Sheets API**.
3. APIs and Services, Credentials, Create credentials, **Service account**.
   Name it something like `jbkfinder-reader`. No roles needed.
4. Open the service account, **Keys** tab, Add key, Create new key, **JSON**.
   A JSON file downloads. Inside it you need two values: `client_email` and
   `private_key`.
5. Open your candidate sheet
   (`1jXMVbQfg-KLaHXg6fzb8t7vQjRMqP4XwxBRGwmZMM5s`), Share, paste the
   `client_email` value, give it **Viewer**, uncheck notify, Share.

## 3. Deploy to Vercel

1. Vercel, Add New, Project, import `jobkreatorsofficial-a11y/jbkfinder`.
2. Framework preset Next.js. Leave build settings on defaults.
3. Environment variables, add these for Production, Preview and Development:

| Name | Value |
| --- | --- |
| `N8N_WEBHOOK_URL_SHINE` | `https://n8n-production-c2e8.up.railway.app/webhook/shine-source` |
| `N8N_WEBHOOK_URL_FOUNDIT` | check the Foundit workflow's webhook path in n8n |
| `N8N_WEBHOOK_URL_APNA` | `https://n8n-production-c2e8.up.railway.app/webhook/apna-source` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from the JSON key |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the whole `private_key` value, including the BEGIN and END lines |

The older `N8N_WEBHOOK_URL` is still read as a fallback for Shine, so the
current deployment does not break the moment this ships. Set
`N8N_WEBHOOK_URL_SHINE` and you can drop it.

If a platform's webhook variable is missing, that tab returns a clear error
naming the variable it wants. The other tabs keep working.

For `GOOGLE_SERVICE_ACCOUNT_KEY`, paste the value exactly as it appears in the
JSON file. The literal `\n` sequences are fine, the app converts them. If you
paste from a text editor with real line breaks that also works.

4. Deploy.

## 4. Before each run

Portal sessions expire in hours and throttle after heavy same-day use, which is
why credentials are per-run inputs rather than stored secrets. They are posted
to the workflow and never written to a log or echoed back in a response.

**Shine.** Open a logged-in `recruiter.shine.com` tab. DevTools, Application,
Cookies, `recruiter.shine.com`. Copy `csrftoken` and `sessionid` into one
string: `csrftoken=VALUE; sessionid=VALUE`. Paste into the Shine Cookie field.
The CSRF field fills itself.

**Foundit.** Paste the full cookie string from a logged-in recruiter session.

**Apna.** DevTools, Network, click any `white-collar-search` request, Request
Headers, copy the `authorization` value. It starts with `Token eyJ`. Org ID and
Workspace ID are prefilled with the current account's values.

If a run polls out with no new rows, the console says so and suggests the
session or token has expired. That is the usual cause.

## 5. Getting past 40 candidates per JD

Shine and Apna return a single page of profiles per search with no usable
pagination parameter. To go wider, rerun the same JD with a different
**keyword**:

| Run | Keyword |
| --- | --- |
| 1 | `counsellor` |
| 2 | `counselor` |
| 3 | `admission` |
| 4 | `telecaller` |

Each keyword returns a largely different cohort. The sheet upserts on
**Candidate ID**, so overlaps merge instead of duplicating, and the dashboard
collapses them again on read. Four runs lands around 120 unique candidates.

Toggle **This run only** in the results header to switch between the latest
batch and everything in the sheet.

## Sheet layout

- **Shine.csv**, **Foundit**, **Apna** contain candidate rows, one tab per
  platform. Key column is `Candidate ID`.
There is no longer a **Run Log** tab in play; run history is local to the
browser.

Rows written before August 2026 have no `Candidate ID`. Clearing those once
gives a clean cumulative count.

## Architecture

- `app/page.tsx` holds all client state, keyed by platform id
- `lib/platforms.ts` is the platform registry, the single source of truth
- `app/api/source/route.ts` resolves the webhook and runs the job. If the
  Supabase recruiter-account registry has active logins for the platform, it
  fans out one webhook call per login in parallel, aggregates + dedupes the
  results, stores them, and returns the merged list. With no registry it falls
  back to the single cookie posted with the request, so the console keeps
  working before Supabase is set up.
- `app/api/accounts/route.ts` manages the per-login session cookies (attach,
  toggle active). Cookies live only in Supabase behind the service role and are
  never returned to the browser.
- `app/api/results/route.ts` reads stored candidates for a platform from Supabase
- `app/api/runs/route.ts` reads shared run history from Supabase
- `app/api/parse-pdf/route.ts` extracts text from an uploaded JD PDF
- `lib/supabase.ts` is the server-side Supabase (PostgREST) helper
- `lib/sheets.ts` is the legacy read-only Google Sheets helper (being retired)
- `lib/runHistory.ts` is the legacy localStorage run history (being retired)

Storage moved from the Google Sheet to Supabase (`supabase/migrations/0001_init.sql`,
`supabase/seed.sql`). The candidate store, the recruiter-account registry and run
history all live there; the dashboard reads through the Next API using the
service-role key (RLS on, no anon access — candidate rows are PII, cookies are
secret).

### n8n resilience

The n8n `N8N_ENCRYPTION_KEY` changed at some point, orphaning every stored
Google/Gmail/Gemini credential. Because the Google Sheets write aborted the run
before `Respond With Candidates`, the dashboard got nothing. The three workflows
now set the Sheets / Gmail / run-log nodes (and Shine's Gemini JD-parse) to
*continue-on-error*, so `Respond` always fires and returns the scored
candidates. Storage is handled by the Next API into Supabase instead. Restoring
the original encryption key is optional now: it sharpens Shine's ranking (the
Gemini skill-parse) and re-enables the summary emails.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

Typecheck before committing:

```bash
npx tsc --noEmit -p .
```
