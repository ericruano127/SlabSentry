"use client";
import Link from "next/link";
import { useState } from "react";
import { ASSESS, fmtDate, Pill } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

function MetricsTable({ title, groups }: { title: string; groups: Record<string, any> }) {
  return (
    <div className="scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><h3>{title}</h3>
      <table className="table small"><thead><tr><th>Group</th><th>n</th><th>Missed fakes</th><th>Missed-fake rate</th><th>False flags</th><th>False-flag rate</th><th>Weak catches</th><th>Over-cautious</th><th>Abstained</th><th>Weighted cost</th></tr></thead>
        <tbody>{Object.entries(groups).map(([k, m]) => (
          <tr key={k}><td>{k}</td><td>{m.n}</td><td style={{ color: m.missedFakes ? "var(--bad)" : undefined }}>{m.missedFakes}</td><td>{pct(m.missedFakeRate)}</td><td>{m.falseFlags}</td><td>{pct(m.falseFlagRate)}</td><td>{m.weakCatches}</td><td>{m.overCautious}</td><td>{m.abstained}</td><td>{m.weightedCost}</td></tr>
        ))}</tbody></table></div>
  );
}

export default function Quality() {
  const [mode, setMode] = useState<"recorded" | "replay">("recorded");
  const acc = useApi<any>(`/api/admin/accuracy?mode=${mode}`);
  const labels = useApi<any>("/api/admin/labels");
  const tech = useApi<any>("/api/admin/techniques");
  const rel = useApi<any>("/api/admin/releases");
  const [label, setLabel] = useState<Record<string, { truth: string; basis: string; note: string }>>({});
  const [t, setT] = useState({ title: "", description: "", source: "", graders: "" });
  const [r, setR] = useState({ version: "", publicNotes: "", internalNotes: "" });
  const [override, setOverride] = useState("");
  const [msg, setMsg] = useState<{ text: string; issues?: string[] } | null>(null);
  const act = async (fn: () => Promise<unknown>, ok: string, reload: () => void) => {
    setMsg(null);
    try { await fn(); setMsg({ text: ok }); reload(); } catch (e: any) { setMsg({ text: e.message, issues: e.body?.issues ?? e.body?.reasons }); }
  };
  if (acc.error?.body?.error === "mfa_required") return <div className="banner warn">Staff tools require two-factor authentication. <Link href="/account">Enable it</Link>.</div>;
  if (acc.error) return <div className="banner bad">{acc.error.message}</div>;
  const a = acc.data;
  return (
    <div className="stack">
      <div className="row spread"><h1>Quality & releases</h1><Link href="/admin">← Staff tools</Link></div>
      {msg && <div className="banner" role="status">{msg.text}{msg.issues && <ul className="small">{msg.issues.map((i) => <li key={i}>{i}</li>)}</ul>}</div>}

      <section className="card stack">
        <div className="row spread"><h2>Accuracy on labeled slabs</h2>
          <div className="toggle" role="group" aria-label="Evaluation mode">
            <button className={mode === "recorded" ? "on" : ""} onClick={() => setMode("recorded")}>As delivered</button>
            <button className={mode === "replay" ? "on" : ""} onClick={() => setMode("replay")}>Current rules (replay)</button>
          </div></div>
        {a && (<>
          <p className="small muted">Missed fakes weigh {a.missedFakeWeight}× a false flag. Labels come from independent confirmation (never from our own output); {a.disputed} disputed session(s) excluded until adjudicated.{a.missingInputs ? ` ${a.missingInputs} labeled session(s) have no stored engine inputs.` : ""}</p>
          {a.smallSampleWarning && <div className="banner warn small">Fewer than 100 labeled slabs — rates are not statistically meaningful yet.</div>}
          <MetricsTable title="Overall" groups={{ all: a.overall }} />
          <MetricsTable title="By category" groups={a.byCategory} />
          <MetricsTable title="By grader" groups={a.byGrader} />
          <MetricsTable title="By holder generation" groups={a.byGeneration} />
        </>)}
      </section>

      <section className="card stack">
        <h2>Labeling queue</h2>
        <p className="small muted">Only sessions whose photos are consented for model work (or internal staff samples). Record how authenticity was established.</p>
        {(labels.data?.queue ?? []).map((s: any) => {
          const v = label[s.id] ?? { truth: "genuine", basis: "grader_confirmation", note: "" };
          return (
            <div key={s.id} className="row" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 220 }}><Link href={`/sessions/${s.id}`}>{s.title ?? s.id.slice(0, 8)}</Link><div className="small muted">{s.category} · {s.grader ?? "?"} · report: {ASSESS[s.overall_assessment]?.label ?? "—"} · {s.labels} label(s)</div></div>
              <select aria-label="Truth" value={v.truth} onChange={(e) => setLabel({ ...label, [s.id]: { ...v, truth: e.target.value } })} style={{ width: 140 }}><option>genuine</option><option>counterfeit</option><option>altered</option></select>
              <select aria-label="Basis" value={v.basis} onChange={(e) => setLabel({ ...label, [s.id]: { ...v, basis: e.target.value } })} style={{ width: 220 }}>
                {["grader_confirmation", "grader_submission_result", "expert_inspection", "law_enforcement_or_marketplace", "internal_test_sample"].map((b) => <option key={b} value={b}>{b.replace(/_/g, " ")}</option>)}</select>
              <input aria-label="Evidence note" placeholder="How was this confirmed?" value={v.note} onChange={(e) => setLabel({ ...label, [s.id]: { ...v, note: e.target.value } })} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn" disabled={v.note.length < 10} onClick={() => act(() => api("/api/admin/labels", { method: "POST", json: { sessionId: s.id, ...v } }), "Label saved.", () => { labels.reload(); acc.reload(); })}>Save label</button>
            </div>
          );
        })}
        {labels.data && !labels.data.queue.length && <p className="muted small">Nothing to label right now.</p>}
        {labels.data?.disputed.length > 0 && <div className="banner warn small">{labels.data.disputed.length} session(s) have conflicting labels and need adjudication.</div>}
      </section>

      <section className="card stack">
        <h2>Counterfeit technique log</h2>
        <div className="grid grid-2">
          <input aria-label="Title" placeholder="Technique (internal)" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} />
          <input aria-label="Source" placeholder="Source (report, marketplace, grader notice…)" value={t.source} onChange={(e) => setT({ ...t, source: e.target.value })} />
          <input aria-label="Graders" placeholder="Graders, comma-separated" value={t.graders} onChange={(e) => setT({ ...t, graders: e.target.value })} />
          <input aria-label="Description" placeholder="Description (internal only)" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />
        </div>
        <button className="btn" disabled={t.title.length < 3 || t.description.length < 10 || t.source.length < 3} onClick={() => act(() => api("/api/admin/techniques", { method: "POST", json: { ...t, graders: t.graders.split(",").map((x) => x.trim()).filter(Boolean) } }), "Technique logged.", tech.reload)}>Log technique</button>
        <div className="scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><table className="table small"><thead><tr><th>Technique</th><th>Graders</th><th>Status</th><th>Mitigated in</th><th>Updated</th></tr></thead>
          <tbody>{(tech.data?.techniques ?? []).map((x: any) => (
            <tr key={x.id}><td>{x.title}<div className="muted">{x.source}</div></td><td>{x.graders.join(", ")}</td>
              <td><select aria-label="Status" value={x.status} onChange={(e) => act(() => api("/api/admin/techniques", { method: "PATCH", json: { id: x.id, status: e.target.value } }), "Updated.", tech.reload)}>{["reported", "confirmed", "mitigated", "not_reproducible"].map((s) => <option key={s}>{s}</option>)}</select></td>
              <td>{x.mitigation_release ?? "—"}</td><td>{fmtDate(x.updated_at)}</td></tr>
          ))}</tbody></table></div>
      </section>

      <section className="card stack">
        <h2>Releases</h2>
        {rel.data && <p className="small muted">Current build: {rel.data.components.rules} · library {rel.data.components.library.version} ({rel.data.components.library.sha256?.slice(0, 10)}) · {Object.keys(rel.data.components.vision).length} vision tools · app {rel.data.components.app}</p>}
        <div className="grid grid-2">
          <input aria-label="Version" placeholder="Version e.g. 2026.11.6" value={r.version} onChange={(e) => setR({ ...r, version: e.target.value })} />
          <span />
          <textarea aria-label="Public notes" rows={4} placeholder="Public patch notes — general, no detection details" value={r.publicNotes} onChange={(e) => setR({ ...r, publicNotes: e.target.value })} />
          <textarea aria-label="Internal notes" rows={4} placeholder="Internal: what changed, why, data used" value={r.internalNotes} onChange={(e) => setR({ ...r, internalNotes: e.target.value })} />
        </div>
        <button className="btn" disabled={!r.version || r.publicNotes.length < 10 || r.internalNotes.length < 20} onClick={() => act(() => api("/api/admin/releases", { method: "POST", json: r }), "Draft created with accuracy evaluation.", rel.reload)}>Create draft release</button>
        <div className="scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><table className="table small"><thead><tr><th>Version</th><th>Status</th><th>Gate</th><th>Missed fakes / false flags (n)</th><th>Public notes</th><th></th></tr></thead>
          <tbody>{(rel.data?.releases ?? []).map((x: any) => (
            <tr key={x.id}><td>{x.version}</td><td><Pill tone={x.status === "published" ? "ok" : "warn"}>{x.status}</Pill></td>
              <td><Pill tone={x.gate?.pass ? "ok" : "bad"}>{x.gate?.pass ? "pass" : "regression"}</Pill>{x.gate_override_reason && <div className="muted">override: {x.gate_override_reason}</div>}{!x.gate?.pass && <div className="muted">{x.gate?.reasons?.join(" ")}</div>}</td>
              <td>{x.accuracy?.overall.missedFakes ?? "—"} / {x.accuracy?.overall.falseFlags ?? "—"} ({x.accuracy?.overall.n ?? 0})</td>
              <td style={{ maxWidth: 280 }}>{x.public_notes}</td>
              <td>{x.status === "draft" && <div className="stack">
                <button className="btn" onClick={() => act(() => api(`/api/admin/releases/${x.id}/publish`, { method: "POST", json: override ? { overrideReason: override } : {} }), `Published ${x.version}.`, rel.reload)}>Publish</button>
                {!x.gate?.pass && <input aria-label="Override reason (owner only)" placeholder="Owner override reason" value={override} onChange={(e) => setOverride(e.target.value)} />}
              </div>}</td></tr>
          ))}</tbody></table></div>
      </section>
    </div>
  );
}
