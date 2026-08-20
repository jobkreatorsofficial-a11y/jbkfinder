import { NextRequest, NextResponse } from "next/server";
import { getRuns } from "@/lib/sheets";

export const runtime = "nodejs";

// Reads the "Run Log" tab so the dashboard can show past sourcing runs.

export async function POST(req: NextRequest) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body ok
  }
  const sheetUrl = String(body?.sheetUrl || "").trim();
  if (!sheetUrl) {
    return NextResponse.json({ ok: false, error: "No sheet selected." }, { status: 400 });
  }

  try {
    const runs = await getRuns(sheetUrl);
    return NextResponse.json({ ok: true, runs });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Could not read past runs from the sheet." },
      { status: 500 }
    );
  }
}
