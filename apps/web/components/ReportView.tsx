"use client";
import { useState } from "react";
import { AuthImage } from "./AuthImage";
import { ASSESS, fmtDate, Pill, STATUS } from "./ui";

type Obs = { id: string; category: string; title: string; status: string; detail: string; basis: string; imageRefs?: string[]; regions?: { x: number; y: number; w: number; h: number; label?: string }[]; provenance: { source: string; url?: string } };

const BASIS: Record<string, string> = { fact: "Verified fact", inference: "Visual inference", unknown: "Unresolved" };
const SRC: Record<string, string> = { official_api: "Official grader data", official_link: "Official link (not retrieved)", user_supplied_reference: "User-supplied", user_capture: "Your photo", computed: "Computed", third_party_search: "Image search", user_attested: "You confirmed" };

function ObsRow({ o, privateImages }: { o: Obs; privateImages: boolean }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[o.status] ?? { label: o.status, tone: "" };
  return (
    <div className="obs">
      <div><Pill tone={s.tone}>{s.label}</Pill></div>
      <div>
        <strong>{o.title}</strong>
        <div className="small muted">{BASIS[o.basis]} · {SRC[o.provenance.source] ?? o.provenance.source}{o.provenance.url && <> · <a href={o.provenance.url} target="_blank" rel="noopener noreferrer">source</a></>}</div>
        <p className="small" style={{ margin: "4px 0" }}>{o.detail}</p>
        {privateImages && !!o.imageRefs?.length && <button className="btn small" style={{ minHeight: 34, padding: "4px 10px" }} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide evidence" : "Show evidence"}</button>}
        {open && o.imageRefs?.map((id) => <div key={id} className="overlay-wrap" style={{ marginTop: 8 }}><AuthImage id={id} alt={`Evidence for ${o.title}`} /></div>)}
      </div>
    </div>
  );
}

export function ReportView({ report, privateImages = true, history }: { report: any; privateImages?: boolean; history?: { analysis_run: number; assessment: string; evidence: string; created_at: string }[] }) {
  const e = report.engine;
  const a = ASSESS[e.assessment];
  const id = report.identification;
  const group = (cats: string[]) => e.observations.filter((o: Obs) => cats.includes(o.category));
  const section = (title: string, cats: string[], extra?: React.ReactNode) => {
    const items = group(cats);
    return (
      <section className="card" aria-labelledby={title}>
        <h2 id={title}>{title}</h2>
        {extra}
        {items.length ? items.map((o: Obs) => <ObsRow key={o.id} o={o} privateImages={privateImages} />) : <p className="muted small">No checks in this category for the evidence provided.</p>}
      </section>
    );
  };
  return (
    <div className="stack">
      <div className={`banner ${a?.tone}`} role="status">
        <div className="row spread">
          <div><div className="small muted">Overall assessment</div><div style={{ fontSize: "1.3rem", fontWeight: 750 }}>{a?.label}</div></div>
          <Pill>Evidence quality: {e.evidenceQuality.level}</Pill>
        </div>
        {e.evidenceQuality.reasons.length > 0 && <ul className="small" style={{ margin: "8px 0 0" }}>{e.evidenceQuality.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
      </div>

      <section className="card">
        <h2>Recommended next action</h2>
        <ol>{e.nextActions.map((n: string) => <li key={n}>{n}</li>)}</ol>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2>Card identification</h2>
          <table className="table small"><tbody>
            <tr><th>Grader</th><td>{id.graderName ?? "—"}</td></tr>
            <tr><th>Cert #</th><td>{id.certNumber ?? "—"}</td></tr>
            {id.record && (<>
              <tr><th>Card</th><td>{[id.record.year, id.record.brand, id.record.subject].filter(Boolean).join(" ")}</td></tr>
              <tr><th>Number / parallel</th><td>{[id.record.cardNumber && `#${id.record.cardNumber}`, id.record.variety].filter(Boolean).join(" · ") || "—"}</td></tr>
              <tr><th>Grade</th><td>{id.record.grade ?? "—"}</td></tr>
            </>)}
          </tbody></table>
          {!id.record && <p className="small muted">Card details come from the official record when we can retrieve it.</p>}
        </section>
        <section className="card">
          <h2>Official verification</h2>
          <p><Pill tone={report.official.recordStatus === "found" ? "ok" : report.official.recordStatus === "not_found" ? "bad" : "warn"}>{{ found: "Record found", not_found: "No record found", not_checked: "Not checked automatically" }[report.official.recordStatus as string]}</Pill></p>
          <p className="small">Reference images: <strong>{{ official_api: "Official grader images", user_supplied: "User-supplied reference (not retrieved from the grader)", unavailable: "Not available" }[report.official.imageAvailability as string]}</strong></p>
          {report.official.lookupUrl && <a className="btn" href={report.official.lookupUrl} target="_blank" rel="noopener noreferrer">Open official lookup ↗</a>}
        </section>
      </div>

      {e.findings.length > 0 && (
        <section className="card">
          <h2>Risk findings</h2>
          {e.findings.map((f: any) => (
            <div key={f.id} className={`banner ${f.severity === "high" ? "bad" : f.severity === "info" ? "" : "warn"}`} style={{ marginBottom: 10 }}>
              <div className="row"><Pill tone={f.severity === "high" ? "bad" : "warn"}>{f.severity}</Pill><strong>{f.summary}</strong></div>
              <p className="small" style={{ marginTop: 6 }}>{f.explanation}</p>
              {f.legitimateExplanations.length > 0 && <p className="small muted">Could also be: {f.legitimateExplanations.join("; ")}</p>}
            </div>
          ))}
        </section>
      )}

      {section("Reference image comparison", ["reference_comparison", "physical_fingerprint", "image_reuse"])}
      {section("Holder security inspection", ["holder", "security_feature", "tampering"],
        e.holderGeneration && (
          <div className="small" style={{ marginBottom: 8 }}>
            <strong>Holder family:</strong> {e.holderGeneration.candidates.map((c: any) => c.name).join(" or ") || "Unknown"}
            {e.holderGeneration.note && <div className="muted">{e.holderGeneration.note}</div>}
          </div>
        ))}
      {section("Certification & identity checks", ["certification", "identity", "evidence_quality"])}

      {history && history.length > 1 && (
        <section className="card">
          <h2>Assessment history</h2>
          <table className="table small"><thead><tr><th>Run</th><th>Assessment</th><th>Evidence</th><th>When</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.analysis_run}><td>{h.analysis_run}</td><td>{ASSESS[h.assessment]?.label}</td><td>{h.evidence}</td><td>{fmtDate(h.created_at)}</td></tr>)}</tbody></table>
        </section>
      )}
      <p className="small muted">{report.disclaimer} · {e.rulesVersion} · Generated {fmtDate(report.generatedAt)}</p>
    </div>
  );
}
