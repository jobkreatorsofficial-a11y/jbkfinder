import type { PlatformId } from "@/lib/platforms";

// Run history lives in the browser, not in the Google Sheet. The sheet-backed
// "Run Log" tab needed a service account that cannot be created on this Google
// org, so it never returned anything. Runs now come back on the webhook
// response, which is everything an entry needs.

const KEY = "jbkfinder.runHistory";
const MAX_ENTRIES = 100;

export interface RunEntry {
  id: string;
  platform: PlatformId;
  timestamp: string; // ISO
  jobTitle: string;
  clientName: string;
  location: string;
  candidateCount: number;
  revealedCount: number;
  topCandidate: string;
  topScore: number;
  page: number;
  status?: string;
  note?: string;
}

export function newRunId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEntry(v: unknown): v is RunEntry {
  return !!v && typeof v === "object" && typeof (v as RunEntry).id === "string";
}

// Reads never throw: a private window, disabled storage or a hand-edited value
// should show an empty history rather than break the tab.
export function readRunHistory(): RunEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

// Returns the new list so callers can drop it straight into state, even when
// the write itself failed (quota, storage disabled).
export function appendRun(entry: RunEntry): RunEntry[] {
  const next = [entry, ...readRunHistory()].slice(0, MAX_ENTRIES);
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // History is a convenience; losing a write is not worth an error.
  }
  return next;
}

export function clearRunHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
