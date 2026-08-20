import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Forwards the run request to the n8n Shine workflow webhook. The workflow
// sources from Shine, scores, and writes results to the Google Sheet. The
// dashboard then reads results back from the sheet (the webhook returns fast).

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";

export async function POST(req: NextRequest) {
  if (!WEBHOOK_URL) {
    return NextResponse.json(
      { ok: false, error: "Sourcing endpoint is not configured. Set N8N_WEBHOOK_URL." },
      { status: 500 }
    );
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const required = ["jobTitle", "jobDescription", "clientName", "sheetUrl", "recipientEmail", "shineCookie", "shineCsrf"];
  const missing = required.filter((k) => !String(payload?.[k] || "").trim());
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `Fill in these fields first: ${missing.join(", ")}.` },
      { status: 400 }
    );
  }

  // Derive the csrf token from the cookie if the caller left it blank.
  if (!String(payload.shineCsrf || "").trim()) {
    const m = String(payload.shineCookie || "").match(/csrftoken=([^;\s]+)/);
    if (m) payload.shineCsrf = m[1];
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // The workflow runs asynchronously; we only need to know n8n accepted it.
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Sourcing service returned ${res.status}. ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, accepted: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Could not reach the sourcing service. ${e?.message || ""}` },
      { status: 502 }
    );
  }
}
