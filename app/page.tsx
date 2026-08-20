"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Candidate = Record<string, string>;
type Run = Record<string, string>;

const COUNTS = ["25", "40"];

function matchColor(pct: number) {
  if (pct >= 70) return "#2E9E6B";
  if (pct >= 50) return "#F0A24B";
  return "#9AA3C0";
}

export default function Page() {
  // form state
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [location, setLocation] = useState("");
  const [minExperience, setMinExperience] = useState("");
  const [candidateCount, setCandidateCount] = useState("25");
  const [clientName, setClientName] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [shineCookie, setShineCookie] = useState("");
  const [shineCsrf, setShineCsrf] = useState("");
  const [keywordOverride, setKeywordOverride] = useState("");

  const [jdMode, setJdMode] = useState<"paste" | "upload">("paste");
  const [pdfName, setPdfName] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // run state
  const [running, setRunning] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [justAccepted, setJustAccepted] = useState(false);

  // results state
  const [view, setView] = useState<"results" | "runs">("results");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [pollLeft, setPollLeft] = useState(0);
  const [copiedKey, setCopiedKey] = useState("");
  const [runStartedAt, setRunStartedAt] = useState<number>(0);
  const [latestOnly, setLatestOnly] = useState(false);

  const pollTimer = useRef<any>(null);

  const loadResults = useCallback(async (url: string) => {
    if (!url.trim()) return;
    try {
      const r = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: url }),
      });
      const d = await r.json();
      if (d.ok) {
        setCandidates(d.candidates || []);
        return (d.candidates || []) as Candidate[];
      }
    } catch {}
    return [] as Candidate[];
  }, []);

  const loadRuns = useCallback(async (url: string) => {
    if (!url.trim()) return;
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: url }),
      });
      const d = await r.json();
      if (d.ok) setRuns(d.runs || []);
    } catch {}
  }, []);

  // Load history whenever a sheet URL is present (on mount / when it changes).
  useEffect(() => {
    if (sheetUrl.trim()) {
      loadResults(sheetUrl);
      loadRuns(sheetUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetUrl]);

  useEffect(() => () => clearInterval(pollTimer.current), []);

  async function onPdf(file: File) {
    setPdfBusy(true);
    setFormErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/parse-pdf", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) {
        setJobDescription(d.text);
        setPdfName(file.name);
      } else {
        setFormErr(d.error || "Could not read that PDF.");
      }
    } catch {
      setFormErr("Could not read that PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  function csrfFromCookie(cookie: string) {
    const m = cookie.match(/csrftoken=([^;\s]+)/);
    return m ? m[1] : "";
  }

  async function runSourcing() {
    setFormErr("");
    const csrf = shineCsrf.trim() || csrfFromCookie(shineCookie);
    const payload = {
      jobTitle, jobDescription, requiredSkills, location, minExperience,
      candidateCount, clientName, sheetUrl, recipientEmail,
      shineCookie, shineCsrf: csrf,
      shineKeywordOverride: keywordOverride.trim().toLowerCase(),
    };
    const required: [string, string][] = [
      ["Job title", jobTitle], ["Job description", jobDescription],
      ["Client name", clientName], ["Sheet URL", sheetUrl],
      ["Notify email", recipientEmail], ["Shine cookie", shineCookie],
    ];
    const missing = required.filter(([, v]) => !String(v).trim()).map(([k]) => k);
    if (missing.length) {
      setFormErr(`Fill in: ${missing.join(", ")}.`);
      return;
    }
    if (!csrf) {
      setFormErr("Could not find the csrf token. Paste the CSRF value, or include csrftoken=... in the cookie.");
      return;
    }

    setRunning(true);
    setJustAccepted(false);
    setRunStartedAt(Date.now());
    setLatestOnly(true);
    try {
      const r = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!d.ok) {
        setFormErr(d.error || "Could not start sourcing.");
        setRunning(false);
        return;
      }
      setJustAccepted(true);
      setView("results");
      startPolling(Date.now());
    } catch (e: any) {
      setFormErr("Could not reach the sourcing service.");
      setRunning(false);
    }
  }

  // The webhook returns as soon as n8n accepts the run, so poll the sheet until
  // rows stamped after this run show up. A Shine run takes roughly 30 to 120
  // seconds end to end, so the window is generous.
  function startPolling(startedAt: number) {
    clearInterval(pollTimer.current);
    setLoadingResults(true);
    let ticks = 0;
    const maxTicks = 45; // ~135s at 3s
    setPollLeft(maxTicks);
    const cutoff = startedAt - 60000;
    pollTimer.current = setInterval(async () => {
      ticks++;
      setPollLeft(maxTicks - ticks);
      const rows = await loadResults(sheetUrl);
      await loadRuns(sheetUrl);
      const fresh = (rows || []).some((c) => {
        const t = Date.parse(String(c["Sourced At"] || ""));
        return !Number.isNaN(t) && t >= cutoff;
      });
      if (fresh || ticks >= maxTicks) {
        clearInterval(pollTimer.current);
        setLoadingResults(false);
        setRunning(false);
      }
    }, 3000);
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
  const CLUSTERS: Record<string, string[]> = {
    "Delhi NCR": ["greater noida", "noida", "new delhi", "delhi", "gurugram", "gurgaon", "ghaziabad", "faridabad"],
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
        if (hay.includes(city) && city.length > bestLen) { best = name; bestLen = city.length; }
      }
    }
    return best;
  }

  function tsOf(c: Candidate) {
    const t = Date.parse(String(c["Sourced At"] || ""));
    return Number.isNaN(t) ? 0 : t;
  }

  const cluster = targetCluster(location);
  const clusterCities = cluster ? CLUSTERS[cluster] : [];

  const visible = (() => {
    const byId = new Map<string, Candidate>();
    for (const c of candidates) {
      const id = String(c["Candidate ID"] || "").trim() ||
        `${String(c["Name"] || "").toLowerCase()}|${String(c["Number"] || c["Phone"] || "")}`;
      const prev = byId.get(id);
      if (!prev || tsOf(c) >= tsOf(prev)) byId.set(id, c);
    }
    let list = Array.from(byId.values());
    if (latestOnly && runStartedAt) {
      // Rows written during or after this run. Small grace window for clock skew.
      const cutoff = runStartedAt - 60000;
      const fresh = list.filter((c) => tsOf(c) >= cutoff);
      if (fresh.length) list = fresh;
    }
    return list.sort((a, b) => {
      const d = tsOf(b) - tsOf(a);
      if (d !== 0) return d;
      return Number(b["Match %"] || 0) - Number(a["Match %"] || 0);
    });
  })();

  // derived stats from the visible set
  const total = visible.length;
  const uniqueTotal = new Set(
    candidates.map((c) => String(c["Candidate ID"] || "").trim()).filter(Boolean)
  ).size;
  const withPhone = visible.filter((c) => String(c["Number"] || c["Phone"] || "").trim()).length;
  const localCount = clusterCities.length
    ? visible.filter((c) => {
        const hay = String(c["Location"] || "").toLowerCase();
        return clusterCities.some((city) => hay.includes(city));
      }).length
    : 0;
  const topScore = visible.reduce((m, c) => Math.max(m, Number(c["Match %"] || 0)), 0);

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

        <h1>Source candidates from a JD</h1>
        <p className="lede">
          Drop in a job description and your Shine session. We pull ranked,
          India-based candidates with phone numbers into your sheet.
        </p>

        <div className="field">
          <label>Job title</label>
          <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Academic Counselor" />
        </div>

        <div className="field">
          <label>Job description</label>
          <div className="jd-tabs">
            <button className={`jd-tab ${jdMode === "paste" ? "on" : ""}`} onClick={() => setJdMode("paste")} type="button">Paste text</button>
            <button className={`jd-tab ${jdMode === "upload" ? "on" : ""}`} onClick={() => setJdMode("upload")} type="button">Upload PDF</button>
          </div>
          {jdMode === "paste" ? (
            <textarea value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Paste the full JD here..." />
          ) : (
            <>
              <div
                className={`dropzone ${pdfName ? "parsed" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onPdf(f); }}
              >
                {pdfBusy ? "Reading PDF..."
                  : pdfName ? <><strong>{pdfName}</strong> loaded. Text is ready.</>
                  : <>Drop a JD PDF here or <strong>browse</strong></>}
              </div>
              <input ref={fileRef} type="file" accept="application/pdf" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPdf(f); }} />
              {jobDescription && jdMode === "upload" && (
                <textarea style={{ marginTop: 8 }} value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
              )}
            </>
          )}
        </div>

        <div className="field">
          <label>Required skills <span className="hint">comma separated</span></label>
          <input type="text" value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} placeholder="e.g. Inside Sales, Counseling, CRM" />
        </div>

        <div className="row2">
          <div className="field">
            <label>Location priority</label>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Andheri, Mumbai" />
          </div>
          <div className="field">
            <label>Min experience <span className="hint">yrs</span></label>
            <input type="number" value={minExperience} onChange={(e) => setMinExperience(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className="field">
          <label>How many candidates</label>
          <div className="count-pick">
            {COUNTS.map((c) => (
              <button key={c} type="button" className={`count-opt ${candidateCount === c ? "on" : ""}`} onClick={() => setCandidateCount(c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Shine keyword <span className="hint">optional, overrides auto</span></label>
          <input type="text" value={keywordOverride} onChange={(e) => setKeywordOverride(e.target.value)} placeholder="e.g. counsellor, counselor, admission, telecaller" />
          <div className="field-note">
            Shine returns one page per search. Rerun the same JD with a different
            keyword to pull a fresh cohort. Duplicates are merged on Candidate ID.
          </div>
        </div>

        <div className="row2">
          <div className="field">
            <label>Client name</label>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Boston Institute" />
          </div>
          <div className="field">
            <label>Notify email</label>
            <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="you@company.com" />
          </div>
        </div>

        <div className="field">
          <label>Destination Google Sheet URL</label>
          <input type="text" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="Paste the sheet link" />
        </div>

        <div className="session-box">
          <div className="box-title">● Shine session</div>
          <p className="box-note">
            From a logged-in Shine tab: DevTools then Application then Cookies.
            Copy csrftoken and sessionid from the same session. Sessions expire
            in a few hours, so grab a fresh one before a run.
          </p>
          <div className="field">
            <label>Cookie <span className="hint">csrftoken=...; sessionid=...</span></label>
            <input type="text" value={shineCookie}
              onChange={(e) => { setShineCookie(e.target.value); if (!shineCsrf) setShineCsrf(csrfFromCookie(e.target.value)); }}
              placeholder="csrftoken=X; sessionid=Y" />
          </div>
          <div className="field">
            <label>CSRF token <span className="hint">auto-filled from cookie</span></label>
            <input type="text" value={shineCsrf} onChange={(e) => setShineCsrf(e.target.value)} placeholder="csrftoken value only" />
          </div>
        </div>

        <button className="run-btn" onClick={runSourcing} disabled={running}>
          {running ? "Sourcing..." : "Run sourcing"}
        </button>

        {formErr && <div className="form-err">{formErr}</div>}
      </aside>

      {/* ---------------- RESULTS CANVAS ---------------- */}
      <main className="canvas">
        <div className="canvas-head">
          <div>
            <h2>{view === "results" ? "Candidates" : "Past runs"}</h2>
            <p>
              {view === "results"
                ? sheetUrl ? "Live from your sheet, newest first. Duplicate profiles are collapsed by Candidate ID." : "Add a sheet URL to see results here."
                : "Every sourcing run logged to this sheet."}
            </p>
          </div>
          <div className="head-actions">
            {view === "results" && runStartedAt > 0 && (
              <button
                type="button"
                className={`scope-toggle ${latestOnly ? "on" : ""}`}
                onClick={() => setLatestOnly((v) => !v)}
              >
                {latestOnly ? "This run only" : "All candidates"}
              </button>
            )}
            <div className="view-toggle">
              <button className={view === "results" ? "on" : ""} onClick={() => setView("results")}>Candidates</button>
              <button className={view === "runs" ? "on" : ""} onClick={() => setView("runs")}>Run history</button>
            </div>
          </div>
        </div>

        {justAccepted && loadingResults && (
          <div className="banner">
            <span>●</span>
            <span>Sourcing kicked off. Pulling from Shine and scoring now. Results will appear below in a few seconds {pollLeft > 0 ? `(checking... ${pollLeft})` : ""}.</span>
          </div>
        )}

        {view === "results" && (
          <>
            <div className="stats">
              <div className="stat">
                <div className="k">Showing</div>
                <div className="v mono">{total}</div>
                <div className="foot">{uniqueTotal ? `${uniqueTotal} unique in sheet` : "in this sheet"}</div>
              </div>
              <div className="stat signal">
                <div className="k">With phone</div>
                <div className="v mono">{withPhone}</div>
                <div className="foot">{total ? Math.round((withPhone / total) * 100) : 0}% reachable</div>
              </div>
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

            {loadingResults && total === 0 ? (
              <div className="loading-block">
                <div className="spinner" />
                <div className="working-note"><b>Working through Shine.</b> This takes a few seconds while we source and score.</div>
              </div>
            ) : total === 0 ? (
              <div className="empty">
                <div className="big">No candidates yet</div>
                <div className="small">Run a sourcing job from the left, or paste a sheet URL that already has results. Delivered candidates show up here with phone numbers and match scores.</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="cand">
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Candidate</th>
                      <th>Phone</th>
                      <th>Match</th>
                      <th>Skills</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c, i) => {
                      const phone = String(c["Number"] || c["Phone"] || "").trim();
                      const pct = Number(c["Match %"] || 0);
                      const pri = String(c["Priority"] || "Low");
                      const link = String(c["Profile Link"] || "");
                      return (
                        <tr key={i}>
                          <td><span className={`pill pri-${pri}`}>{pri}</span></td>
                          <td>
                            <div className="cand-name">
                              {link ? <a href={link} target="_blank" rel="noreferrer">{c["Name"]}</a> : c["Name"]}
                            </div>
                            <div className="cand-meta">
                              {[c["Title"], c["Company"]].filter(Boolean).join(" @ ")}
                              {c["Location"] ? ` · ${c["Location"]}` : ""}
                            </div>
                          </td>
                          <td>
                            {phone
                              ? <span className="phone-cell mono">{phone}</span>
                              : <span className="phone-none">on profile</span>}
                          </td>
                          <td>
                            <div className="match-bar-wrap">
                              <span className="match-num mono">{pct}%</span>
                              <span className="match-bar"><span className="match-fill" style={{ width: `${Math.min(100, pct)}%`, background: matchColor(pct) }} /></span>
                            </div>
                          </td>
                          <td style={{ maxWidth: 220 }}>
                            <span style={{ fontSize: 12, color: "var(--slate-2)" }}>{c["Matching Skills"] || "-"}</span>
                          </td>
                          <td>
                            {phone && (
                              <button className="copy-btn" onClick={() => copyText(phone, `p${i}`)}>
                                {copiedKey === `p${i}` ? "Copied" : "Copy no."}
                              </button>
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
            {runs.length === 0 ? (
              <div className="empty">
                <div className="big">No runs logged yet</div>
                <div className="small">Each time you run sourcing, a row lands in the Run Log tab with counts and the top candidate. They will list here newest first.</div>
              </div>
            ) : (
              <div className="runs">
                {runs.map((r, i) => (
                  <div className="run-card" key={i}>
                    <div>
                      <div className="run-role">{r["Role"] || "Untitled role"}</div>
                      <div className="run-sub">
                        {r["Client"] || "-"} · {r["Date"] ? new Date(r["Date"]).toLocaleString() : ""}
                        {r["Top Candidate"] ? ` · top: ${r["Top Candidate"]} (${r["Top Score"] || 0}%)` : ""}
                      </div>
                    </div>
                    <div className="run-nums">
                      <div className="rn"><div className="n mono">{r["Candidates Found"] || 0}</div><div className="l">found</div></div>
                      <div className="rn sig"><div className="n mono">{r["With Numbers"] || 0}</div><div className="l">phones</div></div>
                      <div className="rn"><div className="n mono">{r["Mumbai"] || 0}</div><div className="l">local</div></div>
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
