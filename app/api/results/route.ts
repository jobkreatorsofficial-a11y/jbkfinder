import { NextRequest, NextResponse } from "next/server";
import { getCandidates, isSheetsConfigured } from "@/lib/sheets";
import { getPlatform } from "@/lib/platforms";

export const runtime = "nodejs";

// Reads the candidate rows the workflow wrote to the platform's results tab.
// Candidates normally arrive on the webhook response now; this backs the
// polling fallback and the initial load for a pasted sheet URL.
// A missing platform param falls back to Shine so older callers keep working.

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // fall through with empty body
  }

  const platform = getPlatform(req.nextUrl.searchParams.get("platform") ?? body?.platform);

  const sheetUrl = String(body?.sheetUrl ?? "").trim();
  if (!sheetUrl) {
    return NextResponse.json({ ok: false, error: "No sheet selected." }, { status: 400 });
  }

  try {
    const rows = await getCandidates(sheetUrl, platform.sheetTab);
    // `configured` tells the dashboard whether an empty list means "the tab is
    // empty" or "we cannot read the sheet at all", so it knows not to clear
    // candidates that came back on the webhook response.
    return NextResponse.json({
      ok: true,
      platform: platform.id,
      configured: isSheetsConfigured(),
      candidates: rows,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { ok: false, error: msg || "Could not read candidates from the sheet." },
      { status: 500 }
    );
  }
}
