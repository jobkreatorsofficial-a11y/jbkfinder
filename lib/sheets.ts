import { google } from "googleapis";

// Reads candidate rows and run-log rows back from the same Google Sheet the
// n8n workflow writes to. Auth uses a service account (env vars set in Vercel).
// The service account email must be shared as a Viewer on the sheet.

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) {
    throw new Error("Google service account credentials are not configured.");
  }
  return new google.auth.JWT({
    email,
    key,
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

export async function getCandidates(sheetUrl: string) {
  const id = extractSheetId(sheetUrl);
  return readTab(id, "Shine.csv");
}

export async function getRuns(sheetUrl: string) {
  const id = extractSheetId(sheetUrl);
  const runs = await readTab(id, "Run Log");
  // Newest first.
  return runs.reverse();
}
