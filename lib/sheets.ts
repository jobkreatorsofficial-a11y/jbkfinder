import { google } from "googleapis";

// Reads candidate rows and run-log rows back from the same Google Sheet the
// n8n workflow writes to. Auth uses a service account (env vars set in Vercel).
// The service account email must be shared as a Viewer on the sheet.
//
// Candidates now come back on the webhook response, so this is only needed for
// the polling fallback and for loading an existing sheet. When the service
// account is not configured the reader returns no rows instead of throwing, so
// the dashboard shows an empty state rather than a 500. Run history no longer
// touches the sheet at all; it lives in localStorage (lib/runHistory.ts).

function serviceAccount(): { email: string; key: string } | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) return null;
  return { email, key };
}

export function isSheetsConfigured(): boolean {
  return serviceAccount() !== null;
}

function getAuth() {
  const creds = serviceAccount();
  if (!creds) {
    throw new Error("Google service account credentials are not configured.");
  }
  return new google.auth.JWT({
    email: creds.email,
    key: creds.key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

// Pull the spreadsheet ID out of a full Google Sheets URL, or accept a raw ID.
export function extractSheetId(input: string): string {
  const m = String(input || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(input || "").trim();
}

function rowsToObjects(values: string[][]): Record<string, string>[] {
  if (!values || values.length < 2) return [];
  const header = values[0].map((h) => String(h || "").trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.every((c) => !String(c || "").trim())) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = row[c] != null ? String(row[c]) : "";
    }
    out.push(obj);
  }
  return out;
}

async function readTab(sheetId: string, tab: string): Promise<Record<string, string>[]> {
  const sheets = sheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!A1:Z10000`,
    });
    return rowsToObjects((res.data.values as string[][]) || []);
  } catch (e: any) {
    // A missing tab or empty sheet should read as "no data yet", not a crash.
    if (String(e?.message || "").includes("Unable to parse range")) return [];
    throw e;
  }
}

// The tab name comes from the platform registry, so each platform reads its
// own results tab out of the same spreadsheet.
export async function getCandidates(sheetUrl: string, tab: string) {
  if (!isSheetsConfigured()) return [];
  const id = extractSheetId(sheetUrl);
  return readTab(id, tab);
}
