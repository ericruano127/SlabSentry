"use client";
import Link from "next/link";
import { useState } from "react";
import { fmtDate, Pill } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";

/** Staff: verified templates (label / UV / microprint) per holder generation, and price-provider checks. */
export default function TemplatesAdmin() {
  const t = useApi<any>("/api/admin/templates");
  const lib = useApi<any>("/api/admin/library");
  const [form, setForm] = useState({ imageId: "", generationId: "", kind: "label", note: "" });
  const [q, setQ] = useState("");
  const [sample, setSample] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (t.error?.body?.error === "mfa_required") return <div className="banner warn">Staff tools require two-factor authentication. <Link href="/account">Enable it in Account → Security</Link>.</div>;
  if (t.error) return <div className="banner bad">{t.error.message}</div>;
  const gens = lib.data?.published.content.generations ?? [];
  return (
    <div className="stack">
      <div className="row spread"><h1>Verified templates & market data</h1><Link href="/admin">← Staff tools</Link></div>
      <section className="card stack">
        <h2>Register a verified template</h2>
        <p className="small muted">Only from a slab whose authenticity was established outside this app (e.g. confirmed by the grader). The note is audited. Templates enable label layout/colour, UV-pattern and microprint comparisons for that holder generation.</p>
        <div className="grid grid-2">
          <div className="field"><label htmlFor="img">Image id (from a session)</label><input id="img" value={form.imageId} onChange={(e) => setForm({ ...form, imageId: e.target.value.trim() })} /></div>
          <div className="field"><label htmlFor="gen">Holder generation</label><select id="gen" value={form.generationId} onChange={(e) => setForm({ ...form, generationId: e.target.value })}><option value="">Select…</option>{gens.map((g: any) => <option key={g.id} value={g.id}>{g.graderId} · {g.name}</option>)}</select></div>
          <div className="field"><label htmlFor="kind">Kind</label><select id="kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="label">Label (front photo of the slab)</option><option value="uv">UV pattern (blacklight photo)</option><option value="microprint">Microprint close-up</option></select></div>
          <div className="field"><label htmlFor="note">How was authenticity established?</label><input id="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <button className="btn primary" disabled={!form.imageId || !form.generationId || form.note.length < 10} onClick={async () => { try { await api("/api/admin/templates", { method: "POST", json: form }); setMsg("Template registered."); t.reload(); } catch (e: any) { setMsg(e.message); } }}>Register template</button>
      </section>
      <section className="card scroll-x">
        <h2>Templates</h2>
        <table className="table small"><thead><tr><th>Generation</th><th>Kind</th><th>Status</th><th>Verification</th><th>Added</th><th></th></tr></thead>
          <tbody>{(t.data?.templates ?? []).map((x: any) => (
            <tr key={x.id}><td>{x.generation_id}</td><td>{x.kind}</td><td><Pill tone={x.status === "active" ? "ok" : ""}>{x.status}</Pill></td><td>{x.verification_note}</td><td>{fmtDate(x.created_at)}</td>
              <td>{x.status === "active" && <button className="btn" onClick={async () => { await api("/api/admin/templates", { method: "DELETE", json: { id: x.id } }); t.reload(); }}>Retire</button>}</td></tr>
          ))}</tbody></table>
        {t.data && !t.data.templates.length && <p className="muted small">No templates yet — label, UV and microprint checks stay inconclusive until verified templates are added.</p>}
      </section>
      <section className="card stack">
        <h2>Price data provider</h2>
        <p className="small muted">A provider is used only when enabled in <code>config/fmv.json</code>, its token is set, and the grade→field mapping has been confirmed against a real response here.</p>
        <div className="row"><input aria-label="Sample search" placeholder="e.g. 1999 Pokemon Charizard 4" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" disabled={q.length < 3} onClick={async () => { try { setSample(await api(`/api/admin/market?q=${encodeURIComponent(q)}`)); } catch (e: any) { setMsg(e.message); } }}>Check mapping</button></div>
        {sample && <pre className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>{JSON.stringify(sample, null, 2)}</pre>}
      </section>
      {msg && <div className="banner" role="status">{msg}</div>}
    </div>
  );
}
