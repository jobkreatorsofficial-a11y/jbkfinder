"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PHONE_NOTICE,
  PLATFORMS,
  PLATFORM_IDS,
  type CredentialField,
  type Platform,
  type PlatformId,
} from "@/lib/platforms";
import {
  appendRun,
  clearRunHistory,
  newRunId,
  readRunHistory,
  type RunEntry,
} from "@/lib/runHistory";

type Candidate = Record<string, string>;

const COUNTS = ["25", "40"];
const POLL_INTERVAL_MS = 3000;
const MAX_TICKS = 45; // roughly 135 seconds

interface FormState {
  jobTitle: string;
  jobDescription: string;
  requiredSkills: string;
  location: string;
  strictLocation: boolean;
  minExperience: string;
  maxExperience: string;
  minSalary: string;
  maxSalary: string;
  minAge: string;
  maxAge: string;
  page: string;
  revealCount: string;
  candidateCount: string;
  clientName: string;
  recipientEmail: string;
  sheetUrl: string;
  keywordOverride: string;
  credentials: Record<string, string>;
  jdMode: "paste" | "upload";
  pdfName: string;
  pdfBusy: boolean;
}

interface RunState {
  running: boolean;
  formErr: string;
  // The webhook now holds the connection open while the workflow runs, so a
  // request can be in flight for up to 30 seconds before candidates land.
  submitting: boolean;
  justAccepted: boolean;
  loadingResults: boolean;
  pollLeft: number;
  runStartedAt: number;
  latestOnly: boolean;
  timedOut: boolean;
}

type ByPlatform<T> = Record<PlatformId, T>;

function blankForm(platform: Platform): FormState {
  const credentials: Record<string, string> = {};
  for (const c of platform.credentials) credentials[c.name] = c.defaultValue || "";
  return {
    jobTitle: "",
    jobDescription: "",
    requiredSkills: "",
    location: "",
    strictLocation: true,
    minExperience: "",
    maxExperience: "",
    minSalary: "",
    maxSalary: "",
    minAge: "",
    maxAge: "",
    page: "1",
    revealCount: "20",
    candidateCount: "25",
    clientName: "",
    recipientEmail: "",
    sheetUrl: "",
    keywordOverride: "",
    credentials,
    jdMode: "paste",
    pdfName: "",
    pdfBusy: false,
  };
}

function blankRunState(): RunState {
  return {
    running: false,
    formErr: "",
    submitting: false,
    justAccepted: false,
    loadingResults: false,
    pollLeft: 0,
    runStartedAt: 0,
    latestOnly: false,
    timedOut: false,
  };
}

function initialBy<T>(make: (id: PlatformId) => T): ByPlatform<T> {
  return {
    shine: make("shine"),
    foundit: make("foundit"),
    apna: make("apna"),
  };
}

function matchColor(pct: number) {
  if (pct >= 70) return "#2E9E6B";
  if (pct >= 50) return "#F0A24B";
  return "#9AA3C0";
}

// Column names drift a little between the three workflow sheets, so read the
// first header that actually carries a value.
function pick(row: Candidate, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

const COL = {
  priority: ["Priority"],
  name: ["Name", "Candidate Name", "Full Name"],
  title: ["Title", "Designation", "Current Title", "Current Designation"],
  company: ["Company", "Current Company", "Employer"],
  location: ["Location", "City", "Current Location"],
  experience: ["Experience (yrs)", "Experience", "Total Experience", "Experience Years"],
  salary: ["Current Salary (LPA)", "Current Salary", "Salary (LPA)", "Salary", "CTC"],
  match: ["Match %", "Match", "Score"],
  number: ["Number", "Phone", "Mobile"],
  contact: ["Contact Status", "Contact?", "Contact", "Contactable"],
  link: ["Profile Link", "Profile URL", "Profile", "Link"],
  sourcedAt: ["Sourced At", "SourcedAt", "Date"],
  candidateId: ["Candidate ID", "CandidateID", "Id"],
};

const CLUSTERS: Record<string, string[]> = {
  "Delhi NCR": [
    "greater noida",
    "noida",
    "new delhi",
    "delhi",
    "gurugram",
    "gurgaon",
    "ghaziabad",
    "faridabad",
  ],
  "Mumbai MMR": ["navi mumbai", "mumbai", "thane", "andheri"],
  Bengaluru: ["bengaluru", "bangalore"],
  Pune: ["pune"],
  Hyderabad: ["hyderabad", "secunderabad"],
  Chennai: ["chennai"],
  Kolkata: ["kolkata"],
  Ahmedabad: ["ahmedabad"],
};

function targetCluster(loc: string) {
  const hay = String(loc || "").toLowerCase();
  let best = "";
  let bestLen = 0;
  for (const name of Object.keys(CLUSTERS)) {
    for (const city of CLUSTERS[name]) {
      if (hay.includes(city) && city.length > bestLen) {
        best = name;
        bestLen = city.length;
      }
    }
  }
  return best;
}

// "Contact Status" is the key the workflows send now; older sheet rows carried
// a plain yes/no column. Both mean the number is in hand.
const CONTACT_READY = ["yes", "revealed", "unlocked"];
function contactReady(value: string) {
  return CONTACT_READY.includes(String(value || "").trim().toLowerCase());
}

// A run entry for the local history. The response array is already rank
// ordered, so the first row is the top candidate.
function buildRunEntry(
  id: PlatformId,
  f: FormState,
  rows: Candidate[],
  page: number
): RunEntry {
  const top = rows[0];
  return {
    id: newRunId(),
    platform: id,
    timestamp: new Date().toISOString(),
    jobTitle: f.jobTitle.trim(),
    clientName: f.clientName.trim(),
    location: f.location.trim(),
    candidateCount: rows.length,
    revealedCount: rows.filter(
      (c) => String(c["Contact Status"] || "").trim().toLowerCase() === "revealed"
    ).length,
    topCandidate: top ? pick(top, COL.name) : "",
    topScore: top ? Number(pick(top, COL.match) || 0) : 0,
    page,
  };
}

function tsOf(c: Candidate) {
  const t = Date.parse(pick(c, COL.sourcedAt));
  return Number.isNaN(t) ? 0 : t;
}

// The page field is free text; fall back to the first page on anything odd.
function pageOf(f: FormState) {
  const p = parseInt(f.page, 10);
  return Number.isFinite(p) && p > 0 ? p : 1;
}

function csrfFromCookie(cookie: string) {
  const m = String(cookie || "").match(/csrftoken=([^;\s]+)/);
  return m ? m[1] : "";
}

export default function Page() {
  const [active, setActive] = useState<PlatformId>("shine");
  const [forms, setForms] = useState<ByPlatform<FormState>>(() =>
    initialBy((id) => blankForm(PLATFORMS[id]))
  );
  const [runState, setRunState] = useState<ByPlatform<RunState>>(() => initialBy(blankRunState));
  const [results, setResults] = useState<ByPlatform<Candidate[]>>(() => initialBy(() => []));
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [runFilter, setRunFilter] = useState<"all" | PlatformId>("all");
  const [view, setView] = useState<"results" | "runs">("results");
  const [copiedKey, setCopiedKey] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);
  // One poll timer per platform, so a Shine run keeps polling while the
  // recruiter works on the Apna tab.
  const pollTimers = useRef<Partial<Record<PlatformId, ReturnType<typeof setInterval>>>>({});
  // Every Candidate ID seen on this platform this session. The results table
  // only holds the latest run, so excludeIds is built from here instead.
  const seenIds = useRef<ByPlatform<Set<string>>>(initialBy(() => new Set<string>()));

  const platform = PLATFORMS[active];
  const form = forms[active];
  const run = runState[active];
  const candidates = results[active];

  const rememberIds = useCallback((id: PlatformId, rows: Candidate[]) => {
    const set = seenIds.current[id];
    for (const c of rows) {
      const cid = pick(c, COL.candidateId);
      if (cid) set.add(cid);
    }
  }, []);

  const patchForm = useCallback((id: PlatformId, patch: Partial<FormState>) => {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const patchRun = useCallback((id: PlatformId, patch: Partial<RunState>) => {
    setRunState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const setCredential = useCallback(
    (id: PlatformId, name: string, value: string) => {
      setForms((prev) => {
        const next = { ...prev[id].credentials, [name]: value };
        // Shine only: the CSRF field fills itself out of the pasted cookie.
        if (id === "shine" && name === "shineCookie" && !String(next.shineCsrf || "").trim()) {
          const derived = csrfFromCookie(value);
          if (derived) next.shineCsrf = derived;
        }
        return { ...prev, [id]: { ...prev[id], credentials: next } };
      });
    },
    []
  );

  const loadResults = useCallback(async (id: PlatformId, url: string): Promise<Candidate[]> => {
    if (!url.trim()) return [];
    try {
      const r = await fetch(`/api/results?platform=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: url, platform: id }),
      });
      const d = await r.json();
      if (d.ok) {
        const rows = (d.candidates || []) as Candidate[];
        // Without a service account the sheet always reads as empty; do not let
        // that wipe candidates the webhook already returned.
        if (d.configured !== false) setResults((prev) => ({ ...prev, [id]: rows }));
        rememberIds(id, rows);
        return rows;
      }
    } catch {
      // A failed poll tick is not fatal; the next tick tries again.
    }
    return [];
  }, [rememberIds]);

  // History is local to the browser, so it is read once on mount.
  useEffect(() => {
    setRuns(readRunHistory());
  }, []);

  const activeSheetUrl = form.sheetUrl;
  useEffect(() => {
    if (activeSheetUrl.trim()) loadResults(active, activeSheetUrl);
  }, [active, activeSheetUrl, loadResults]);

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const id of PLATFORM_IDS) {
        const t = timers[id];
        if (t) clearInterval(t);
      }
    };
  }, []);

  async function onPdf(id: PlatformId, file: File) {
    patchForm(id, { pdfBusy: true });
    patchRun(id, { formErr: "" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/parse-pdf", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) {
        patchForm(id, { jobDescription: d.text, pdfName: file.name });
      } else {
        patchRun(id, { formErr: d.error || "Could not read that PDF." });
      }
    } catch {
      patchRun(id, { formErr: "Could not read that PDF." });
    } finally {
      patchForm(id, { pdfBusy: false });
    }
  }

  // Fallback for workflows that still answer with an acknowledgement instead of
  // the candidate list: poll the sheet until rows stamped after this run show up.
  const startPolling = useCallback(
    (id: PlatformId, url: string, startedAt: number, meta: { form: FormState; page: number }) => {
      const existing = pollTimers.current[id];
      if (existing) clearInterval(existing);
      patchRun(id, { loadingResults: true, timedOut: false, pollLeft: MAX_TICKS });

      let ticks = 0;
      const cutoff = startedAt - 60000; // small grace window for clock skew
      const timer = setInterval(async () => {
        ticks++;
        patchRun(id, { pollLeft: Math.max(0, MAX_TICKS - ticks) });
        const rows = await loadResults(id, url);
        const freshRows = rows.filter((c) => tsOf(c) >= cutoff);
        const fresh = freshRows.length > 0;
        if (fresh || ticks >= MAX_TICKS) {
          clearInterval(timer);
          pollTimers.current[id] = undefined;
          patchRun(id, {
            loadingResults: false,
            running: false,
            pollLeft: 0,
            timedOut: !fresh,
          });
          if (fresh) setRuns(appendRun(buildRunEntry(id, meta.form, freshRows, meta.page)));
        }
      }, POLL_INTERVAL_MS);
      pollTimers.current[id] = timer;
    },
    [loadResults, patchRun]
  );

  function buildPayload(id: PlatformId): Record<string, string> {
    const p = PLATFORMS[id];
    const f = forms[id];
    const payload: Record<string, string> = {
      platform: p.id,
      jobTitle: f.jobTitle,
      jobDescription: f.jobDescription,
      requiredSkills: f.requiredSkills,
      location: f.location,
      candidateCount: f.candidateCount,
      clientName: f.clientName,
      sheetUrl: f.sheetUrl,
      recipientEmail: f.recipientEmail,
    };
    if (p.supports.strictLocation) payload.strictLocation = f.strictLocation ? "true" : "false";
    if (p.supports.experienceRange) {
      payload.minExperience = f.minExperience;
      payload.maxExperience = f.maxExperience;
    }
    if (p.supports.salaryRange) {
      payload.minSalary = f.minSalary;
      payload.maxSalary = f.maxSalary;
    }
    if (p.supports.ageRange) {
      payload.minAge = f.minAge;
      payload.maxAge = f.maxAge;
    }
    if (p.supports.pagination) {
      payload.page = String(pageOf(f));
    }
    if (p.supports.revealCount) {
      // Blank omits the key so the workflow applies its own default of 20. An
      // explicit 0 is sent through and means reveal nothing.
      const reveal = f.revealCount.trim();
      if (reveal && Number.isFinite(Number(reveal))) {
        payload.revealCount = String(Number(reveal));
      }
    }
    if (p.supports.excludeIds) {
      // Every Candidate ID already on screen for this platform, so a repeat run
      // walks past them instead of returning the same people.
      payload.excludeIds = Array.from(seenIds.current[id]).join(",");
    }
    if (p.supports.keywordOverride && p.keywordKey) {
      payload[p.keywordKey] = f.keywordOverride.trim().toLowerCase();
    }
    for (const c of p.credentials) {
      let value = f.credentials[c.name] || "";
      if (id === "shine" && c.name === "shineCsrf" && !value.trim()) {
        value = csrfFromCookie(f.credentials.shineCookie || "");
      }
      payload[c.name] = value.trim();
    }
    return payload;
  }

  async function runSourcing() {
    const id = active;
    const p = PLATFORMS[id];
    const f = forms[id];
    patchRun(id, { formErr: "" });

    const required: [string, string][] = [
      ["Job title", f.jobTitle],
      ["Job description", f.jobDescription],
      ["Client name", f.clientName],
      ["Sheet URL", f.sheetUrl],
      ["Notify email", f.recipientEmail],
      ...p.credentials
        .filter((c) => c.required)
        .map((c) => [c.label, f.credentials[c.name] || ""] as [string, string]),
    ];
    const missing = required.filter(([, v]) => !String(v).trim()).map(([k]) => k);
    if (missing.length) {
      patchRun(id, { formErr: `Fill in: ${missing.join(", ")}.` });
      return;
    }

    const payload = buildPayload(id);

    if (id === "shine" && !payload.shineCsrf) {
      patchRun(id, {
        formErr:
          "Could not find the csrf token. Paste the CSRF value, or include csrftoken=... in the cookie.",
      });
      return;
    }

    const pageUsed = pageOf(f);
    const startedAt = Date.now();
    patchRun(id, {
      running: true,
      submitting: true,
      justAccepted: false,
      timedOut: false,
      runStartedAt: startedAt,
      latestOnly: true,
    });

    try {
      const r = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d.ok) {
        patchRun(id, {
          formErr: d.error || "Could not start sourcing.",
          running: false,
          submitting: false,
        });
        return;
      }

      setView("results");

      // Walk to the next block on the following run, so repeat runs against the
      // same JD keep pulling fresh people.
      if (p.supports.pagination) patchForm(id, { page: String(pageUsed + 1) });

      // The webhook returns the scored candidates itself, so show them straight
      // away. Only fall back to polling the sheet when it came back empty,
      // which means an older workflow that only writes to the sheet.
      const direct = (Array.isArray(d.candidates) ? d.candidates : []) as Candidate[];
      if (direct.length) {
        setResults((prev) => ({ ...prev, [id]: direct }));
        rememberIds(id, direct);
        patchRun(id, {
          running: false,
          submitting: false,
          justAccepted: true,
          loadingResults: false,
          timedOut: false,
        });
        setRuns(appendRun(buildRunEntry(id, f, direct, pageUsed)));
        return;
      }

      patchRun(id, { submitting: false, justAccepted: true });
      startPolling(id, f.sheetUrl, startedAt, { form: f, page: pageUsed });
    } catch {
      patchRun(id, {
        formErr: "Could not reach the sourcing service.",
        running: false,
        submitting: false,
      });
    }
  }

  function copyText(txt: string, key: string) {
    if (!txt) return;
    navigator.clipboard?.writeText(txt).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1400);
    });
  }

  // The sheet is cumulative and upserts on Candidate ID, so the same profile can
  // appear once per run keyword. Collapse to one row per candidate (newest wins)
  // and show the freshest sourcing first.
  const cluster = targetCluster(form.location);
  const clusterCities = cluster ? CLUSTERS[cluster] : [];

  const visible = (() => {
    const byId = new Map<string, Candidate>();
    for (const c of candidates) {
      const id =
        pick(c, COL.candidateId) ||
        `${pick(c, COL.name).toLowerCase()}|${pick(c, COL.number)}`;
      const prev = byId.get(id);
      if (!prev || tsOf(c) >= tsOf(prev)) byId.set(id, c);
    }
    let list = Array.from(byId.values());
    if (run.latestOnly && run.runStartedAt) {
      const cutoff = run.runStartedAt - 60000;
      const fresh = list.filter((c) => tsOf(c) >= cutoff);
      if (fresh.length) list = fresh;
    }
    return list.sort((a, b) => {
      const d = tsOf(b) - tsOf(a);
      if (d !== 0) return d;
      return Number(pick(b, COL.match) || 0) - Number(pick(a, COL.match) || 0);
    });
  })();

  const total = visible.length;
  const uniqueTotal = new Set(
    candidates.map((c) => pick(c, COL.candidateId)).filter(Boolean)
  ).size;
  const directPhone = platform.phoneAvailability === "direct";
  const withPhone = visible.filter((c) => pick(c, COL.number)).length;
  const unlockable = visible.filter((c) => !contactReady(pick(c, COL.contact))).length;
  const localCount = clusterCities.length
    ? visible.filter((c) => {
        const hay = pick(c, COL.location).toLowerCase();
        return clusterCities.some((city) => hay.includes(city));
      }).length
    : 0;
  const topScore = visible.reduce((m, c) => Math.max(m, Number(pick(c, COL.match) || 0)), 0);

  const phoneNotice = PHONE_NOTICE[platform.phoneAvailability];

  const filteredRuns = runFilter === "all" ? runs : runs.filter((r) => r.platform === runFilter);

  function renderCredential(c: CredentialField) {
    const value = form.credentials[c.name] ?? "";
    const common = {
      value,
      placeholder: c.placeholder,
      onChange: (e: { target: { value: string } }) => setCredential(active, c.name, e.target.value),
    };
    return (
      <div className="field" key={c.name}>
        <label>
          {c.label}
          {!c.required && <span className="hint"> optional</span>}
        </label>
        {c.type === "textarea" ? (
          <textarea className="cred-area" {...common} />
        ) : (
          <input type={c.type === "password" ? "password" : "text"} {...common} />
        )}
        {c.helpText && <div className="field-note">{c.helpText}</div>}
      </div>
    );
  }

  return (
    <div className="shell">
      {/* ---------------- CONTROL PANEL ---------------- */}
      <aside className="control">
        <div className="brand">
          <div className="brand-mark">JK</div>
          <div>
            <div className="brand-name">JobKreators</div>
            <div className="brand-sub">Sourcing Console</div>
          </div>
        </div>

        <div className="platform-tabs" role="tablist" aria-label="Sourcing platform">
          {PLATFORM_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active === id}
              className={`platform-tab ${active === id ? "on" : ""}`}
              onClick={() => setActive(id)}
            >
              {PLATFORMS[id].label}
              {runState[id].running && <span className="tab-dot" aria-label="running" />}
            </button>
          ))}
        </div>
        <div className="platform-note">{platform.notes}</div>

        <h1>Source candidates from a JD</h1>
        <p className="lede">
          Drop in a job description and your {platform.label} session. We pull ranked,
          India-based candidates into your sheet.
        </p>

        <div className="field">
          <label>Job title</label>
          <input
            type="text"
            value={form.jobTitle}
            onChange={(e) => patchForm(active, { jobTitle: e.target.value })}
            placeholder="e.g. Academic Counselor"
          />
        </div>

        <div className="field">
          <label>Job description</label>
          <div className="jd-tabs">
            <button
              className={`jd-tab ${form.jdMode === "paste" ? "on" : ""}`}
              onClick={() => patchForm(active, { jdMode: "paste" })}
              type="button"
            >
              Paste text
            </button>
            <button
              className={`jd-tab ${form.jdMode === "upload" ? "on" : ""}`}
              onClick={() => patchForm(active, { jdMode: "upload" })}
              type="button"
            >
              Upload PDF
            </button>
          </div>
          {form.jdMode === "paste" ? (
            <textarea
              value={form.jobDescription}
              onChange={(e) => patchForm(active, { jobDescription: e.target.value })}
              placeholder="Paste the full JD here..."
            />
          ) : (
            <>
              <div
                className={`dropzone ${form.pdfName ? "parsed" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) onPdf(active, f);
                }}
              >
                {form.pdfBusy ? (
                  "Reading PDF..."
                ) : form.pdfName ? (
                  <>
                    <strong>{form.pdfName}</strong> loaded. Text is ready.
                  </>
                ) : (
                  <>
                    Drop a JD PDF here or <strong>browse</strong>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPdf(active, f);
                }}
              />
              {form.jobDescription && (
                <textarea
                  style={{ marginTop: 8 }}
                  value={form.jobDescription}
                  onChange={(e) => patchForm(active, { jobDescription: e.target.value })}
                />
              )}
            </>
          )}
        </div>

        <div className="field">
          <label>
            Required skills <span className="hint">comma separated</span>
          </label>
          <input
            type="text"
            value={form.requiredSkills}
            onChange={(e) => patchForm(active, { requiredSkills: e.target.value })}
            placeholder="e.g. Inside Sales, Counseling, CRM"
          />
        </div>

        <div className="field">
          <label>Location priority</label>
          <input
            type="text"
            value={form.location}
            onChange={(e) => patchForm(active, { location: e.target.value })}
            placeholder="e.g. Andheri, Mumbai"
          />
        </div>

        {platform.supports.strictLocation && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={form.strictLocation}
              onChange={(e) => patchForm(active, { strictLocation: e.target.checked })}
            />
            <span>
              <b>Strict location</b>
              <em>Only keep candidates in these cities. Off ranks them higher instead.</em>
            </span>
          </label>
        )}

        {platform.supports.experienceRange && (
          <div className="row2">
            <div className="field">
              <label>
                Min experience <span className="hint">years</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.minExperience}
                onChange={(e) => patchForm(active, { minExperience: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="field">
              <label>
                Max experience <span className="hint">years</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.maxExperience}
                onChange={(e) => patchForm(active, { maxExperience: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        {platform.supports.salaryRange && (
          <div className="row2">
            <div className="field">
              <label>
                Min package <span className="hint">LPA</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.minSalary}
                onChange={(e) => patchForm(active, { minSalary: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="field">
              <label>
                Max package <span className="hint">LPA</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.maxSalary}
                onChange={(e) => patchForm(active, { maxSalary: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        {platform.supports.ageRange && (
          <div className="row2">
            <div className="field">
              <label>
                Min age <span className="hint">years, optional</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.minAge}
                onChange={(e) => patchForm(active, { minAge: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="field">
              <label>
                Max age <span className="hint">years, optional</span>
              </label>
              <input
                type="number"
                min="0"
                value={form.maxAge}
                onChange={(e) => patchForm(active, { maxAge: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        {(platform.supports.pagination || platform.supports.revealCount) && (
          <div
            className={
              platform.supports.pagination && platform.supports.revealCount ? "row2" : undefined
            }
          >
            {platform.supports.pagination && (
              <div className="field">
                <label>Page</label>
                <input
                  type="number"
                  min="1"
                  value={form.page}
                  onChange={(e) => patchForm(active, { page: e.target.value })}
                />
                <div className="field-note">
                  Steps up on its own after each run, so the next run pulls a fresh block.
                </div>
              </div>
            )}
            {platform.supports.revealCount && (
              <div className="field">
                <label>Reveal count</label>
                <input
                  type="number"
                  min="0"
                  placeholder="20"
                  value={form.revealCount}
                  onChange={(e) => patchForm(active, { revealCount: e.target.value })}
                />
                <div className="field-note">
                  Credits spent per run. Set to 0 to search without revealing numbers. Leave
                  blank for the workflow default of 20.
                </div>
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label>How many candidates</label>
          <div className="count-pick">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                className={`count-opt ${form.candidateCount === c ? "on" : ""}`}
                onClick={() => patchForm(active, { candidateCount: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {platform.supports.keywordOverride && (
          <div className="field">
            <label>
              {platform.label} keyword <span className="hint">optional, overrides auto</span>
            </label>
            <input
              type="text"
              value={form.keywordOverride}
              onChange={(e) => patchForm(active, { keywordOverride: e.target.value })}
              placeholder="e.g. counsellor, counselor, admission, telecaller"
            />
            <div className="field-note">
              {platform.label} returns one page per search. Rerun the same JD with a different
              keyword to pull a fresh cohort. Duplicates are merged on Candidate ID.
            </div>
          </div>
        )}

        <div className="row2">
          <div className="field">
            <label>Client name</label>
            <input
              type="text"
              value={form.clientName}
              onChange={(e) => patchForm(active, { clientName: e.target.value })}
              placeholder="e.g. Boston Institute"
            />
          </div>
          <div className="field">
            <label>Notify email</label>
            <input
              type="email"
              value={form.recipientEmail}
              onChange={(e) => patchForm(active, { recipientEmail: e.target.value })}
              placeholder="you@company.com"
            />
          </div>
        </div>

        <div className="field">
          <label>Destination Google Sheet URL</label>
          <input
            type="text"
            value={form.sheetUrl}
            onChange={(e) => patchForm(active, { sheetUrl: e.target.value })}
            placeholder="Paste the sheet link"
          />
          <div className="field-note">
            Results for this tab are read from the <b>{platform.sheetTab}</b> tab.
          </div>
        </div>

        <div className="session-box">
          <div className="box-title">{platform.label} session</div>
          <p className="box-note">
            Credentials are sent straight to the workflow for this run only. They are never
            stored or echoed back.
          </p>
          {platform.credentials.map(renderCredential)}
        </div>

        <button className="run-btn" onClick={runSourcing} disabled={run.running}>
          {run.running && <span className="spinner sm" />}
          {run.running ? `Sourcing ${platform.label}...` : `Run ${platform.label} sourcing`}
        </button>

        {run.formErr && <div className="form-err">{run.formErr}</div>}
      </aside>

      {/* ---------------- RESULTS CANVAS ---------------- */}
      <main className="canvas">
        <div className="canvas-head">
          <div>
            <h2>
              {view === "results" ? `${platform.label} candidates` : "Past runs"}
            </h2>
            <p>
              {view === "results"
                ? form.sheetUrl
                  ? `Live from the ${platform.sheetTab} tab, newest first. Duplicate profiles are collapsed by Candidate ID.`
                  : "Add a sheet URL to see results here."
                : "Sourcing runs from this browser, newest first."}
            </p>
          </div>
          <div className="head-actions">
            {view === "results" && run.runStartedAt > 0 && (
              <button
                type="button"
                className={`scope-toggle ${run.latestOnly ? "on" : ""}`}
                onClick={() => patchRun(active, { latestOnly: !run.latestOnly })}
              >
                {run.latestOnly ? "This run only" : "All candidates"}
              </button>
            )}
            {view === "runs" && runs.length > 0 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  clearRunHistory();
                  setRuns([]);
                }}
              >
                Clear history
              </button>
            )}
            <div className="view-toggle">
              <button className={view === "results" ? "on" : ""} onClick={() => setView("results")}>
                Candidates
              </button>
              <button className={view === "runs" ? "on" : ""} onClick={() => setView("runs")}>
                Run history
              </button>
            </div>
          </div>
        </div>

        {run.submitting && (
          <div className="banner">
            <span className="spinner sm" />
            <span>
              Sourcing on {platform.label}. Pulling and scoring now — this usually takes 8 to
              30 seconds. Results appear below as soon as the run finishes.
            </span>
          </div>
        )}

        {!run.submitting && run.justAccepted && run.loadingResults && (
          <div className="banner">
            <span>●</span>
            <span>
              Sourcing kicked off on {platform.label}. Pulling and scoring now. Results will
              appear below in a few seconds{" "}
              {run.pollLeft > 0 ? `(checking... ${run.pollLeft})` : ""}.
            </span>
          </div>
        )}

        {run.timedOut && (
          <div className="banner warn">
            <span>●</span>
            <span>
              No new rows landed in the {platform.sheetTab} tab within the polling window. The{" "}
              {platform.label} session or token may have expired, or the workflow may still be
              running. Grab fresh credentials and try again, or reload once the run finishes.
            </span>
          </div>
        )}

        {view === "results" && (
          <>
            {phoneNotice && <div className="notice">{phoneNotice}</div>}

            <div className="stats">
              <div className="stat">
                <div className="k">Showing</div>
                <div className="v mono">{total}</div>
                <div className="foot">{uniqueTotal ? `${uniqueTotal} unique in sheet` : "in this sheet"}</div>
              </div>
              {directPhone ? (
                <div className="stat signal">
                  <div className="k">With phone</div>
                  <div className="v mono">{withPhone}</div>
                  <div className="foot">{total ? Math.round((withPhone / total) * 100) : 0}% reachable</div>
                </div>
              ) : (
                <div className="stat signal">
                  <div className="k">Unlockable</div>
                  <div className="v mono">{unlockable}</div>
                  <div className="foot">
                    {platform.phoneAvailability === "masked" ? "reveal costs credits" : "needs a paid unlock"}
                  </div>
                </div>
              )}
              <div className="stat">
                <div className="k">{cluster || "Local"}</div>
                <div className="v mono">{localCount}</div>
                <div className="foot">{cluster ? "location priority" : "set a location"}</div>
              </div>
              <div className="stat">
                <div className="k">Top match</div>
                <div className="v mono">{topScore}%</div>
                <div className="foot">best fit</div>
              </div>
            </div>

            {(run.submitting || run.loadingResults) && total === 0 ? (
              <div className="loading-block">
                <div className="spinner" />
                <div className="working-note">
                  <b>Working through {platform.label}.</b> This takes a few seconds while we source
                  and score.
                </div>
              </div>
            ) : total === 0 ? (
              <div className="empty">
                <div className="big">No candidates yet</div>
                <div className="small">
                  Run a sourcing job from the left, or paste a sheet URL that already has results
                  on the {platform.sheetTab} tab.
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="cand">
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Name</th>
                      <th>Title</th>
                      <th>Company</th>
                      <th>Location</th>
                      <th>Exp (yrs)</th>
                      <th>Salary (LPA)</th>
                      <th>Match %</th>
                      <th>Number</th>
                      <th>Contact?</th>
                      <th>Profile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c, i) => {
                      const phone = pick(c, COL.number);
                      const pct = Number(pick(c, COL.match) || 0);
                      const pri = pick(c, COL.priority) || "Low";
                      const link = pick(c, COL.link);
                      const contact = pick(c, COL.contact);
                      const contactYes = contactReady(contact);
                      return (
                        <tr key={pick(c, COL.candidateId) || `row-${i}`}>
                          <td>
                            <span className={`pill pri-${pri}`}>{pri}</span>
                          </td>
                          <td>
                            <span className="cand-name">{pick(c, COL.name) || <Dash />}</span>
                          </td>
                          <td className="cell-soft">{pick(c, COL.title) || <Dash />}</td>
                          <td className="cell-soft">{pick(c, COL.company) || <Dash />}</td>
                          <td className="cell-soft">{pick(c, COL.location) || <Dash />}</td>
                          <td className="mono cell-num">{pick(c, COL.experience) || <Dash />}</td>
                          <td className="mono cell-num">{pick(c, COL.salary) || <Dash />}</td>
                          <td>
                            <div className="match-bar-wrap">
                              <span className="match-num mono">{pct}%</span>
                              <span className="match-bar">
                                <span
                                  className="match-fill"
                                  style={{ width: `${Math.min(100, pct)}%`, background: matchColor(pct) }}
                                />
                              </span>
                            </div>
                          </td>
                          <td>
                            {phone ? (
                              <div className="phone-wrap">
                                <span className="phone-cell mono">{phone}</span>
                                <button className="copy-btn" onClick={() => copyText(phone, `p${i}`)}>
                                  {copiedKey === `p${i}` ? "Copied" : "Copy"}
                                </button>
                              </div>
                            ) : (
                              <Dash />
                            )}
                          </td>
                          <td>
                            {contact ? (
                              <span className={`contact-pill ${contactYes ? "yes" : "no"}`}>{contact}</span>
                            ) : (
                              <Dash />
                            )}
                          </td>
                          <td>
                            {link ? (
                              <a href={link} target="_blank" rel="noreferrer">
                                Open
                              </a>
                            ) : (
                              <Dash />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {view === "runs" && (
          <>
            <div className="run-filter">
              <button className={runFilter === "all" ? "on" : ""} onClick={() => setRunFilter("all")}>
                All platforms
              </button>
              {PLATFORM_IDS.map((id) => (
                <button
                  key={id}
                  className={runFilter === id ? "on" : ""}
                  onClick={() => setRunFilter(id)}
                >
                  {PLATFORMS[id].label}
                </button>
              ))}
            </div>

            {filteredRuns.length === 0 ? (
              <div className="empty">
                <div className="big">No runs yet.</div>
                <div className="small">Run a sourcing job and it will appear here.</div>
              </div>
            ) : (
              <div className="runs">
                {filteredRuns.map((r) => (
                  <div className="run-card" key={r.id}>
                    <div>
                      <div className="run-role">
                        {r.jobTitle || "Untitled role"}
                        <span className="run-src">{PLATFORMS[r.platform]?.label || r.platform}</span>
                      </div>
                      <div className="run-sub">
                        {r.clientName || "-"} · {new Date(r.timestamp).toLocaleString()}
                        {r.location ? ` · ${r.location}` : ""}
                        {r.topCandidate ? ` · top: ${r.topCandidate} (${r.topScore}%)` : ""}
                      </div>
                    </div>
                    <div className="run-nums">
                      <div className="rn">
                        <div className="n mono">{r.candidateCount}</div>
                        <div className="l">found</div>
                      </div>
                      <div className="rn sig">
                        <div className="n mono">{r.revealedCount}</div>
                        <div className="l">revealed</div>
                      </div>
                      <div className="rn">
                        <div className="n mono">{r.page}</div>
                        <div className="l">page</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Dash() {
  return <span className="muted-dash">-</span>;
}
