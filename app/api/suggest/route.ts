import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, suggestTitles } from "@/lib/supabase";
import { isPlatformId } from "@/lib/platforms";
import { suggestRoles, type RoleSuggestion } from "@/lib/roleSuggest";

export const runtime = "nodejs";

// Job Title autocomplete. Blends a curated recruiting vocabulary (the terms that
// actually return the right cohorts on the portals) with the real titles already
// sourced into Supabase for that platform. Curated matches come first; observed
// titles fill in the rest, deduped case-insensitively.

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const platformParam = req.nextUrl.searchParams.get("platform");
  const platform = isPlatformId(platformParam) ? platformParam : undefined;

  if (q.length < 2) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  const out: RoleSuggestion[] = suggestRoles(q, 6).map((label) => ({ label, source: "role" }));
  const seen = new Set(out.map((s) => s.label.toLowerCase()));

  if (platform && isSupabaseConfigured()) {
    try {
      for (const title of await suggestTitles(platform, q, 8)) {
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label: title, source: "sourced" });
        if (out.length >= 10) break;
      }
    } catch {
      // Observed-title lookup is best-effort; curated suggestions still return.
    }
  }

  return NextResponse.json({ ok: true, suggestions: out.slice(0, 10) });
}
