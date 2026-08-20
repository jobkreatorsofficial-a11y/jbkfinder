# JobKreators Sourcing Console (jbkfinder)

A Next.js dashboard that drives the n8n workflow **Shine Talent Sourcing (Clean)**
(`gzfBDuXGQIXgkZKi`) and reads the delivered candidates back out of Google Sheets.

Left panel: JD in (paste or PDF), skills, location priority, count, client, notify
email, sheet URL, optional Shine keyword override, and the per-run Shine cookie
plus CSRF token. Right panel: ranked candidates with phone numbers, match bars,
copy-number buttons, and a run history tab.

---

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
3. Environment variables, add these three for Production, Preview and Development:

| Name | Value |
| --- | --- |
| `N8N_WEBHOOK_URL` | `https://n8n-production-c2e8.up.railway.app/webhook/shine-source` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the `client_email` from the JSON key |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the whole `private_key` value, including the BEGIN and END lines |

For `GOOGLE_SERVICE_ACCOUNT_KEY`, paste the value exactly as it appears in the
JSON file. The literal `\n` sequences are fine, the app converts them. If you
paste from a text editor with real line breaks that also works.

4. Deploy.

## 4. Before each run

Shine sessions expire in hours and throttle after heavy same-day use, which is
why the cookie is a per-run input rather than a stored credential.

1. Open a logged-in `recruiter.shine.com` tab.
2. DevTools, Application, Cookies, `recruiter.shine.com`.
3. Copy `csrftoken` and `sessionid` into one string:
   `csrftoken=VALUE; sessionid=VALUE`
4. Paste into the Cookie field. The CSRF field fills itself.

## 5. Getting past 40 candidates per JD

Shine's advanced search returns a single page of about 36 to 40 profiles with no
usable pagination parameter. To go wider, rerun the same JD with a different
**Shine keyword**:

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

The workflow writes two tabs and the dashboard reads both:

- **Shine.csv** — candidate rows. Key column is `Candidate ID`.
- **Run Log** — one row per run, feeds the Run history tab.

Rows written before August 2026 have no `Candidate ID`. Clearing those once
gives a clean cumulative count.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the three values
npm run dev
```
