import { NextRequest, NextResponse } from "next/server";
import { getPlatform, isPlatformId } from "@/lib/platforms";

export const runtime = "nodejs";
export const maxDuration = 60;

// Forwards the run request to the n8n workflow webhook for the chosen platform.
// The webhook holds the connection until the workflow finishes (8-30s) and
// responds with a JSON array of scored candidates, which we hand straight back
// to the dashboard. Older workflows answer with an acknowledgement object
// instead; those come back with an empty candidates array and the dashboard
// falls back to polling the sheet.

const BASE_REQUIRED = ["jobTitle", "jobDescription", "clientName", "sheetUrl", "recipientEmail"];

function resolveWebhook(envName: string, fallbacks: string[] = []): string {
  const names = [envName, ...fallbacks];
  for (const n of names) {
    const v = String(process.env[n] || "").trim();
    if (v) return v;
  }
  return "";
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const platformId = body?.platform;
  if (!isPlatformId(platformId)) {
    return NextResponse.json(
      { ok: false, error: "Unknown platform. Pick Shine, Foundit or Apna." },
      { status: 400 }
    );
  }
  const platform = getPlatform(platformId);

  const webhookUrl = resolveWebhook(platform.webhookEnv, platform.webhookEnvFallbacks);
  if (!webhookUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: `The ${platform.label} sourcing endpoint is not configured. Set ${platform.webhookEnv}.`,
      },
      { status: 500 }
    );
  }

  // Strip the routing field; n8n only wants the run payload.
  const payload: Record<string, unknown> = { ...body };
  delete payload.platform;

  const requiredCreds = platform.credentials.filter((c) => c.required).map((c) => c.name);
  const missing = [...BASE_REQUIRED, ...requiredCreds].filter(
    (k) => !String(payload?.[k] ?? "").trim()
  );
  if (missing.length) {
    const labels = missing.map((k) => {
      const cred = platform.credentials.find((c) => c.name === k);
      return cred ? cred.label : k;
    });
    return NextResponse.json(
      { ok: false, error: `Fill in these fields first: ${labels.join(", ")}.` },
      { status: 400 }
    );
  }

  // Shine only: derive the csrf token from the cookie if the caller left it blank.
  if (platform.id === "shine" && !String(payload.shineCsrf ?? "").trim()) {
    const m = String(payload.shineCookie ?? "").match(/csrftoken=([^;\s]+)/);
    if (m) payload.shineCsrf = m[1];
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `The ${platform.label} sourcing service returned ${res.status}. ${text.slice(0, 200)}`,
        },
        { status: 502 }
      );
    }

    // A JSON array is the scored candidate list. Anything else (an
    // acknowledgement object, an empty body, plain text) means this workflow
    // still writes to the sheet only, so hand back no candidates and let the
    // dashboard poll.
    let candidates: unknown[] = [];
    try {
      const parsed = text.trim() ? JSON.parse(text) : null;
      if (Array.isArray(parsed)) candidates = parsed;
    } catch {
      // Not JSON; treat as an acknowledgement.
    }

    return NextResponse.json({
      ok: true,
      accepted: true,
      platform: platform.id,
      candidates,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { ok: false, error: `Could not reach the ${platform.label} sourcing service. ${msg}` },
      { status: 502 }
    );
  }
}
