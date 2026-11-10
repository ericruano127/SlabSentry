"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { AuthImage } from "@/components/AuthImage";
import { fmtDate, Pill } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";

/**
 * Staff: the reference library's verified templates (label / UV / microprint) per holder generation.
 * Coverage grid → submit → automatic checks → second-person review → used in analysis → retire.
 */
const KIND_LABEL: Record<string, string> = { label: "Label", uv: "UV pattern", microprint: "Microprint" };
const KIND_HELP: Record<string, string> = {
  label: "Straight-on photo of the whole slab (all four edges). The label is cropped automatically.",
  uv: "Blacklight (365–395 nm) photo of the label in a dark room, straight on.",
  microprint: "Sharp close-up of the fine print / security pattern.",
};
let GEN_NAME: Record<string, string> = {};
const genName = (id: string) => GEN_NAME[id] ?? id;
const STATUS_TONE: Record<string, string> = { active: "ok", pending: "warn", rejected: "bad", retired: "" };
const STATUS_LABEL: Record<string, string> = { active: "Approved", pending: "Pending review", rejected: "Rejected", retired: "Retired" };
const VERDICT: Record<string, { tone: string; text: string }> = {
  first: { tone: "", text: "First template for this generation — nothing to compare with" },
  matches_existing: { tone: "ok", text: "Matches an approved template" },
  unclear: { tone: "warn", text: "Comparison with approved templates was unclear" },
  differs_from_all: { tone: "bad", text: "Differs from every approved template — check the generation and the source slab" },
};

export default function TemplatesAdmin() {
  const t = useApi<any>("/api/admin/templates");
  const [msg, setMsg] = useState<{ tone: string; text: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [prefill, setPrefill] = useState<{ generationId: string; kind: string } | null>(null);
  if (t.error?.body?.error === "mfa_required") return <div className="banner warn">Staff tools require two-factor authentication. <Link href="/account">Enable it in Account → Security</Link>.</div>;
  if (t.error) return <div className="banner bad">{t.error.message}</div>;
  if (!t.data) return <p className="muted" aria-busy="true">Loading…</p>;
  const d = t.data;
  GEN_NAME = Object.fromEntries(d.generations.map((g: any) => [g.id, `${g.graderId} · ${g.name}`]));
  const pending = d.templates.filter((x: any) => x.status === "pending");
  const notify = (tone: string, text: string) => { setMsg({ tone, text }); t.reload(); };

  return (
    <div className="stack">
      <div className="row spread"><h1>Reference library: verified templates</h1><Link href="/admin">← Staff tools</Link></div>
      <p className="muted">
        Templates let the label layout/colour, UV and microprint checks compare a slab with a <strong>verified genuine</strong> one of the same holder generation.
        Without one, those checks report “inconclusive”. Every template needs evidence of authenticity, passes automatic checks, and is approved by a second staff member before it's used.
        Up to {d.maxVariants} variants per generation are compared and the best match is used.
      </p>
      {msg && <div className={`banner ${msg.tone}`} role="status">{msg.text}</div>}

      <Coverage rows={d.coverage} kinds={d.kinds} canSubmit={d.me.canSubmit} onAdd={(generationId, kind) => { setPrefill({ generationId, kind }); formRef.current?.scrollIntoView({ behavior: "smooth" }); }} />

      <section className="card stack" aria-labelledby="queue-h">
        <h2 id="queue-h">Review queue {pending.length > 0 && <Pill tone="warn">{pending.length}</Pill>}</h2>
        {!pending.length && <p className="muted small">Nothing waiting for review.</p>}
        {pending.map((x: any) => <ReviewCard key={x.id} t={x} me={d.me} evidenceTypes={d.evidenceTypes} onDone={notify} />)}
      </section>

      {d.me.canSubmit && <div ref={formRef}><SubmitForm key={prefill ? `${prefill.generationId}-${prefill.kind}` : "blank"} d={d} prefill={prefill} onDone={notify} /></div>}

      <Library d={d} onDone={notify} />

      <MarketCheck />
    </div>
  );
}

function Coverage({ rows, kinds, canSubmit, onAdd }: { rows: any[]; kinds: string[]; canSubmit: boolean; onAdd: (g: string, k: string) => void }) {
  const total = rows.length * kinds.length;
  const covered = rows.reduce((n, r) => n + kinds.filter((k) => r.kinds[k].active > 0).length, 0);
  return (
    <section className="card stack scroll-x" aria-labelledby="cov-h">
      <div className="row spread"><h2 id="cov-h">Coverage</h2><span className="small muted">{covered} of {total} generation × check combinations have an approved template</span></div>
      <table className="table small">
        <thead><tr><th>Grader</th><th>Holder generation</th>{kinds.map((k) => <th key={k}>{KIND_LABEL[k]}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.generationId}>
            <td>{r.grader}</td><td>{r.name}</td>
            {kinds.map((k) => {
              const c = r.kinds[k];
              return (
                <td key={k}>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {c.active ? <Pill tone="ok">{c.active} approved</Pill> : <Pill>none</Pill>}
                    {c.pending > 0 && <Pill tone="warn">{c.pending} pending</Pill>}
                    {canSubmit && <button className="btn small" onClick={() => onAdd(r.generationId, k)} aria-label={`Add ${KIND_LABEL[k]} template for ${r.grader} ${r.name}`}>Add</button>}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function Evidence({ t, evidenceTypes }: { t: any; evidenceTypes: Record<string, string> }) {
  return (
    <dl className="small" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px", margin: 0 }}>
      <dt className="muted">Generation</dt><dd>{genName(t.generation_id)} · {KIND_LABEL[t.kind]}{t.variant ? ` · ${t.variant}` : ""}</dd>
      <dt className="muted">Evidence</dt><dd>{evidenceTypes[t.evidence_type] ?? t.evidence_type ?? "—"}</dd>
      <dt className="muted">Note</dt><dd>{t.verification_note}</dd>
      {(t.grader || t.cert_number) && <><dt className="muted">Source slab</dt><dd>{[t.grader, t.cert_number].filter(Boolean).join(" · ")}</dd></>}
      <dt className="muted">Submitted</dt><dd>{t.created_by_email ?? "staff"} · {fmtDate(t.created_at)} · {t.source_kind === "upload" ? "uploaded" : "from a session photo"}</dd>
      {t.quality && <><dt className="muted">Photo quality</dt><dd>{t.quality.ok ? "OK" : "Minor issues"}{t.quality.issues?.length ? ` — ${t.quality.issues.map((i: any) => i.guidance).join(" ")}` : ""}</dd></>}
    </dl>
  );
}

function Consistency({ c }: { c: any }) {
  if (!c) return null;
  const v = VERDICT[c.verdict] ?? { tone: "", text: c.verdict };
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div><Pill tone={v.tone}>{v.text}</Pill></div>
      {c.results?.length > 0 && (
        <ul className="small muted" style={{ margin: 0 }}>
          {c.results.map((r: any) => (
            <li key={r.templateId}>vs. {r.variant ?? "approved template"}: {r.status.replace("_", " ")}
              {r.layout !== undefined && ` (layout ${r.layout}, colour ${r.colour})`}{r.patternIoU !== undefined && ` (pattern overlap ${r.patternIoU})`}{r.inliers !== undefined && ` (${r.inliers} matching points)`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Images({ t }: { t: any }) {
  const img = { width: "100%", maxHeight: 260, objectFit: "contain" as const, borderRadius: 8, background: "var(--surface-2)" };
  return (
    <div className="grid grid-2">
      <figure style={{ margin: 0 }}><AuthImage path={`/api/admin/templates/${t.id}/image`} alt={`${KIND_LABEL[t.kind]} template`} style={img} /><figcaption className="small muted">Template used for comparison</figcaption></figure>
      {t.kind === "label" && <figure style={{ margin: 0 }}><AuthImage path={`/api/admin/templates/${t.id}/image?which=source`} alt="Full source photo" style={img} /><figcaption className="small muted">Full photo it was cut from</figcaption></figure>}
    </div>
  );
}

function ReviewCard({ t, me, evidenceTypes, onDone }: { t: any; me: any; evidenceTypes: Record<string, string>; onDone: (tone: string, text: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const own = t.created_by === me.id;
  const blocked = !me.canReview || (own && !me.selfApproval);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    try {
      await api(`/api/admin/templates/${t.id}/review`, { method: "POST", json: { decision, note } });
      onDone("ok", decision === "approve" ? "Template approved — new analyses will use it." : "Template rejected.");
    } catch (e: any) { onDone("bad", e.message); } finally { setBusy(false); }
  }
  return (
    <article className="card stack" style={{ background: "var(--surface-2)" }} aria-label={`Pending ${KIND_LABEL[t.kind]} template for ${genName(t.generation_id)}`}>
      <Images t={t} />
      <Evidence t={t} evidenceTypes={evidenceTypes} />
      <Consistency c={t.consistency} />
      {blocked ? (
        <p className="small muted">{!me.canReview ? "An admin or owner reviews templates." : "You submitted this one — a second staff member has to review it."}</p>
      ) : (
        <>
          <div className="field"><label htmlFor={`n-${t.id}`}>Review note {own && <span className="muted">(self-approval is enabled for this deployment and will be recorded)</span>}</label>
            <textarea id={`n-${t.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked (required to reject)" /></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => decide("approve")}>Approve</button>
            <button className="btn" disabled={busy || note.trim().length < 5} onClick={() => decide("reject")}>Reject</button>
          </div>
        </>
      )}
    </article>
  );
}

function SubmitForm({ d, prefill, onDone }: { d: any; prefill: { generationId: string; kind: string } | null; onDone: (tone: string, text: string) => void }) {
  const [f, setF] = useState({ generationId: prefill?.generationId ?? "", kind: prefill?.kind ?? "label", variant: "", grader: "", certNumber: "", evidenceType: "grader_confirmed", note: "", imageId: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const ok = f.generationId && f.note.trim().length >= 10 && (file || /^[0-9a-f-]{36}$/i.test(f.imageId));
  async function submit() {
    setBusy(true); setErr(null);
    try {
      let r: any;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        for (const [k, v] of Object.entries(f)) if (v && k !== "imageId") fd.append(k, v);
        r = await api("/api/admin/templates", { method: "POST", body: fd });
      } else r = await api("/api/admin/templates", { method: "POST", json: { ...f, variant: f.variant || null, grader: f.grader || null, certNumber: f.certNumber || null } });
      onDone("ok", `Submitted for review. ${VERDICT[r.consistency?.verdict]?.text ?? ""}`);
      setF({ ...f, note: "", imageId: "", certNumber: "", variant: "" }); setFile(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="card stack" aria-labelledby="submit-h">
      <h2 id="submit-h">Submit a template</h2>
      <p className="small muted">Only from a slab whose authenticity was established <strong>outside this app</strong>. Photos are checked automatically (quality, right kind of photo, comparison with approved templates); metadata is stripped.</p>
      <div className="grid grid-2">
        <div className="field"><label htmlFor="gen">Holder generation</label>
          <select id="gen" value={f.generationId} onChange={set("generationId")}><option value="">Select…</option>{d.generations.map((g: any) => <option key={g.id} value={g.id}>{g.graderId} · {g.name}</option>)}</select></div>
        <div className="field"><label htmlFor="kind">Check</label>
          <select id="kind" value={f.kind} onChange={set("kind")}>{d.kinds.map((k: string) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
          <span className="small muted">{KIND_HELP[f.kind]}</span></div>
        <div className="field"><label htmlFor="file">Photo</label>
          <input id="file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="small muted">Or use a photo already uploaded in a session:</span>
          <input aria-label="Image id from a session" placeholder="Image id (optional)" value={f.imageId} onChange={set("imageId")} disabled={!!file} /></div>
        <div className="field"><label htmlFor="variant">Variant (optional)</label>
          <input id="variant" placeholder="e.g. regular, gold label, autograph" value={f.variant} onChange={set("variant")} /></div>
        <div className="field"><label htmlFor="cert">Source slab cert number (optional)</label>
          <input id="cert" value={f.certNumber} onChange={set("certNumber")} autoComplete="off" /></div>
        <div className="field"><label htmlFor="ev">Evidence of authenticity</label>
          <select id="ev" value={f.evidenceType} onChange={set("evidenceType")}>{Object.entries(d.evidenceTypes).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="note">How was authenticity established?</label>
        <textarea id="note" rows={3} value={f.note} onChange={set("note")} placeholder="e.g. Submitted by us to the grader on 2026-10-02, order #…; cert verified on the grader's site." /></div>
      {err && <div className="banner bad" role="alert">{err}</div>}
      <div><button className="btn primary" disabled={!ok || busy} onClick={submit}>{busy ? "Checking photo…" : "Submit for review"}</button></div>
    </section>
  );
}

function Library({ d, onDone }: { d: any; onDone: (tone: string, text: string) => void }) {
  const [status, setStatus] = useState("");
  const [gen, setGen] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = d.templates.filter((x: any) => (!status || x.status === status) && (!gen || x.generation_id === gen));
  return (
    <section className="card stack scroll-x" aria-labelledby="lib-h">
      <h2 id="lib-h">All templates</h2>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select aria-label="Filter by generation" value={gen} onChange={(e) => setGen(e.target.value)} style={{ width: "auto" }}><option value="">All generations</option>{d.generations.map((g: any) => <option key={g.id} value={g.id}>{g.graderId} · {g.name}</option>)}</select>
      </div>
      <table className="table small">
        <thead><tr><th>Generation</th><th>Check</th><th>Variant</th><th>Status</th><th>Submitted</th><th>Reviewed</th><th></th></tr></thead>
        <tbody>{rows.map((x: any) => (
          <Row key={x.id} x={x} open={open === x.id} toggle={() => setOpen(open === x.id ? null : x.id)} canReview={d.me.canReview} evidenceTypes={d.evidenceTypes} onDone={onDone} />
        ))}</tbody>
      </table>
      {!rows.length && <p className="muted small">No templates{status || gen ? " match these filters" : " yet — label, UV and microprint checks stay inconclusive until verified templates are added"}.</p>}
    </section>
  );
}

function Row({ x, open, toggle, canReview, evidenceTypes, onDone }: { x: any; open: boolean; toggle: () => void; canReview: boolean; evidenceTypes: Record<string, string>; onDone: (tone: string, text: string) => void }) {
  const detail = useApi<any>(open ? `/api/admin/templates/${x.id}` : null, [open]);
  const [reason, setReason] = useState("");
  return (
    <>
      <tr>
        <td>{genName(x.generation_id)}</td><td>{KIND_LABEL[x.kind]}</td><td>{x.variant ?? "—"}</td>
        <td><Pill tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Pill>{x.self_approved && <span className="small muted"> (self-approved)</span>}</td>
        <td>{fmtDate(x.created_at)}</td><td>{x.reviewed_at ? `${fmtDate(x.reviewed_at)} · ${x.reviewed_by_email ?? ""}` : x.review_note ?? "—"}</td>
        <td><button className="btn small" onClick={toggle} aria-expanded={open}>{open ? "Hide" : "Details"}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={7}>
          <div className="stack" style={{ padding: "8px 0" }}>
            <Images t={x} />
            <Evidence t={x} evidenceTypes={evidenceTypes} />
            <Consistency c={x.consistency} />
            {x.review_note && <p className="small"><strong>Review note:</strong> {x.review_note}</p>}
            {x.retire_reason && <p className="small"><strong>Retired:</strong> {x.retire_reason}</p>}
            <div>
              <h3 className="small" style={{ margin: "4px 0" }}>History</h3>
              <ol className="small muted" style={{ margin: 0 }}>{(detail.data?.history ?? []).map((h: any, i: number) => <li key={i}>{fmtDate(h.created_at)} · {h.action.replace("template.", "")} · {h.email ?? "staff"}{h.after?.reason ? ` — ${h.after.reason}` : h.after?.note ? ` — ${h.after.note}` : ""}</li>)}</ol>
            </div>
            {x.status === "active" && canReview && (
              <div className="row" style={{ gap: 8 }}>
                <input aria-label="Reason for retiring" placeholder="Reason for retiring (e.g. superseded, wrong generation)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className="btn" disabled={reason.trim().length < 5} onClick={async () => {
                  try { await api(`/api/admin/templates/${x.id}/retire`, { method: "POST", json: { reason } }); onDone("ok", "Template retired — new analyses no longer use it."); } catch (e: any) { onDone("bad", e.message); }
                }}>Retire</button>
              </div>
            )}
          </div>
        </td></tr>
      )}
    </>
  );
}

function MarketCheck() {
  const [q, setQ] = useState("");
  const [sample, setSample] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card stack">
      <h2>Price data provider</h2>
      <p className="small muted">A provider is used only when enabled in <code>config/fmv.json</code>, its token is set, and the grade→field mapping has been confirmed against a real response here.</p>
      <div className="row"><input aria-label="Sample search" placeholder="e.g. 1999 Pokemon Charizard 4" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="btn" disabled={q.length < 3} onClick={async () => { try { setErr(null); setSample(await api(`/api/admin/market?q=${encodeURIComponent(q)}`)); } catch (e: any) { setErr(e.message); } }}>Check mapping</button></div>
      {err && <div className="banner bad">{err}</div>}
      {sample && <pre className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{JSON.stringify(sample, null, 2)}</pre>}
    </section>
  );
}
