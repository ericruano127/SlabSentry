"use client";
import Link from "next/link";
import { useState } from "react";
import { AssessmentPill, fmtDate } from "@/components/ui";
import { download } from "@/lib/client/api";
import { useApi, type Me } from "@/lib/client/hooks";

export default function History() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const list = useApi<{ sessions: any[]; searchEnabled: boolean }>(`/api/sessions${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const me = useApi<Me>("/api/me");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const batch = me.data?.usage.features.includes("batch_pdf_export");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="stack">
      <h1>Verification history</h1>
      <div className="row">
        {list.data?.searchEnabled ? (
          <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
            <input aria-label="Search history" placeholder="Search cert #, card, grader, assessment…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button className="btn">Search</button>
          </form>
        ) : <span className="small muted">Advanced search is included with Power Collector.</span>}
        {batch ? <button className="btn" disabled={!sel.size} onClick={() => download("/api/reports/batch", "slab-reports.pdf", { method: "POST", json: { ids: [...sel] } }).catch((e) => setErr(e.message))}>Batch PDF ({sel.size})</button> : null}
      </div>
      {err && <div className="banner bad">{err}</div>}
      <div className="card scroll-x">
        <table className="table">
          <thead><tr>{batch && <th><span className="sr-only">Select</span></th>}<th>Slab</th><th>Mode</th><th>Assessment</th><th>Credit</th><th>Date</th></tr></thead>
          <tbody>{list.data?.sessions.map((s) => (
            <tr key={s.id}>
              {batch && <td><input type="checkbox" style={{ width: 20, minHeight: 20 }} disabled={s.status !== "completed"} checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.title ?? s.id}`} /></td>}
              <td><Link href={s.status === "draft" ? `/scan?session=${s.id}` : `/sessions/${s.id}`}>{s.title ?? (s.cert_number ? `${s.grader ?? ""} ${s.cert_number}` : "Draft scan")}</Link></td>
              <td className="small">{s.mode === "in_hand" ? "In hand" : "Listing"}</td>
              <td><AssessmentPill value={s.overall_assessment} /></td>
              <td className="small muted">{{ consumed: "Used", reserved: "Reserved", released: "Not charged", none: "—" }[s.credit_state as string]}</td>
              <td className="small muted">{fmtDate(s.created_at)}</td>
            </tr>
          ))}</tbody>
        </table>
        {list.data && !list.data.sessions.length && <p className="muted">Nothing here yet.</p>}
      </div>
    </div>
  );
}
