import { NextRequest, NextResponse } from "next/server";
import { getCandidates } from "@/lib/sheets";

export const runtime = "nodejs";

// Reads the candidate rows the workflow wrote to the "Shine.csv" tab.
// The dashboard polls this after a run and shows the live results table.

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // fall through with empty body
  }
  const sheetUrl = String(body?.sheetUrl || "").trim();
  if (!sheetUrl) {
    return NextResponse.json({ ok: false, error: "No sheet selected." }, { status: 400 });
  }

  try {
    const rows = await getCandidates(sheetUrl);
    return NextResponse.json({ ok: true, candidates: rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Could not read candidates from the sheet." },
      { status: 500 }
    );
  }
}
