"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { Pill } from "./ui";

const money = (c: number | null | undefined, cur = "USD") => (c == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(c / 100));

/** Fair market value. Always shown as "if genuine" and kept separate from the authenticity assessment. */
export function MarketValue({ sessionId, assessment }: { sessionId: string; assessment: string }) {
  const m = useApi<any>(`/api/sessions/${sessionId}/market`);
  const [form, setForm] = useState({ price: "", date: "", url: "" });
  const [err, setErr] = useState<string | null>(null);
  if (m.error?.status === 403) return null;
  if (!m.data) return null;
  const v = m.data.value;
  const add = async () => {
    setErr(null);
    try {
      await api(`/api/sessions/${sessionId}/comps`, { method: "POST", json: { priceCents: Math.round(Number(form.price) * 100), soldAt: form.date || null, url: form.url || null, gradeLabel: v.gradeLabel } });
      setForm({ price: "", date: "", url: "" });
      m.reload();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <section className="card stack" aria-labelledby="fmv">
      <div className="row spread"><h2 id="fmv">Market value {v.gradeLabel ? `· ${v.gradeLabel}` : ""}</h2><Pill tone={v.confidence === "high" ? "ok" : v.confidence === "none" ? "" : "warn"}>{v.confidence === "none" ? "No estimate yet" : `${v.confidence} confidence`}</Pill></div>
      {assessment === "high_risk_inconsistencies" && <div className="banner bad small">This value applies only if the slab is genuine. Given the high-risk findings above, its real value may be far lower.</div>}
      {v.estimateCents != null ? (
        <div>
          <div className="stat">{money(v.estimateCents, v.currency)}</div>
          {v.lowCents != null && <div className="small muted">Typical range {money(v.lowCents, v.currency)} – {money(v.highCents, v.currency)}</div>}
          {m.data.askingPriceCents != null && <div className="small">Asking price: <strong>{money(m.data.askingPriceCents, v.currency)}</strong> ({Math.round((m.data.askingPriceCents / v.estimateCents) * 100)}% of estimate)</div>}
        </div>
      ) : null}
      <p className="small muted">{v.note} Market value is shown for context and never changes the authenticity findings.</p>
      {m.data.comps.length > 0 && (
        <div className="scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><table className="table small"><thead><tr><th>Sold</th><th>Price</th><th>Grade</th><th>Source</th><th></th></tr></thead>
          <tbody>{m.data.comps.map((c: any) => (
            <tr key={c.id}><td>{c.sold_at ?? "—"}</td><td>{money(c.price_cents, c.currency)}</td><td>{c.grade_label ?? "—"}</td><td>{c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.source}</a> : c.source}</td>
              <td><button className="btn" style={{ minHeight: 30, padding: "2px 8px" }} aria-label="Remove sale" onClick={async () => { await api(`/api/sessions/${sessionId}/comps`, { method: "DELETE", json: { compId: c.id } }); m.reload(); }}>✕</button></td></tr>
          ))}</tbody></table></div>
      )}
      <details>
        <summary className="small">Add a recent sale of the same item, grader and grade</summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input aria-label="Sale price" inputMode="decimal" placeholder="Price (USD)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d.]/g, "") })} style={{ maxWidth: 140 }} />
          <input aria-label="Sale date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ maxWidth: 170 }} />
          <input aria-label="Listing link" placeholder="Link to the sold listing (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn" disabled={!Number(form.price)} onClick={add}>Add sale</button>
        </div>
        {err && <div className="banner bad small">{err}</div>}
      </details>
      {!m.data.providers.some((p: any) => p.connected) && <p className="small muted">Automatic price data isn't connected yet; estimates use the sales you add.</p>}
    </section>
  );
}
