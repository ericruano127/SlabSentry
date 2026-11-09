"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { UpgradePrompt } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { useApi, type Me } from "@/lib/client/hooks";

/**
 * Power plan: multi-card scanning queue. Each row is one slab = one session = one credit.
 * Grader and cert number are read from the label during analysis (QR first, then OCR) and
 * flagged as unconfirmed in the report until the user confirms them.
 */
type Row = { key: string; id?: string; front?: string; back?: string; label?: string; status: string; message?: string };
const ROLES: [keyof Row, string, string][] = [["front", "front", "Front"], ["back", "back", "Back"], ["label", "label_closeup", "Label"]];

export default function Bulk() {
  const me = useApi<Me>("/api/me");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  if (!me.data) return <p className="muted">Loading…</p>;
  if (!me.data.usage.features.includes("bulk_verification")) return <div className="stack"><h1>Bulk verification</h1><UpgradePrompt reason="The multi-card scanning queue is included with Power Collector." /></div>;

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  async function addCard() {
    const { id } = await api<{ id: string }>("/api/sessions", { method: "POST", json: { mode: "in_hand" } });
    setRows((rs) => [...rs, { key: id, id, status: "draft" }]);
  }
  async function upload(row: Row, field: keyof Row, role: string, f: File) {
    update(row.key, { status: "uploading" });
    const fd = new FormData();
    fd.append("file", f);
    fd.append("role", role);
    try {
      const r = await api(`/api/sessions/${row.id}/images`, { method: "POST", body: fd });
      const issues = r.image.quality?.issues?.filter((i: any) => i.severity === "major") ?? [];
      update(row.key, { [field]: f.name, status: issues.length ? "retake" : "draft", message: issues.map((i: any) => i.guidance).join(" ") } as Partial<Row>);
    } catch (e: any) {
      update(row.key, { status: "error", message: e.message });
    }
  }
  async function analyzeAll() {
    setBusy(true);
    setErr(null);
    try {
      const ids = rows.filter((r) => r.front && ["draft", "retake_needed", "limit_reached"].includes(r.status)).map((r) => r.id!);
      const res = await api<{ results: { id: string; status: string; message?: string }[] }>("/api/sessions/bulk-analyze", { method: "POST", json: { ids } });
      for (const r of res.results) update(r.id, { status: r.status, message: r.message });
      me.reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.body?.message ?? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const ready = rows.filter((r) => r.front && r.status === "draft").length;
  return (
    <div className="stack">
      <div className="row spread"><h1>Bulk verification</h1><span className="pill">{me.data.usage.totalRemaining} verifications available</span></div>
      <p className="muted small">Add one row per slab. Each slab uses one credit when its report is delivered. Analyses run in priority order; open each report from History when it completes.</p>
      {err && <div className="banner bad">{err}</div>}
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>#</th>{ROLES.map(([, , l]) => <th key={l}>{l}</th>)}<th>Status</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>{i + 1}</td>
                {ROLES.map(([field, role, l]) => (
                  <td key={l}>
                    <input hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment" ref={(el) => { inputs.current[r.key + role] = el; }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(r, field, role, f); }} />
                    <button className="btn" style={{ minHeight: 36, padding: "4px 10px" }} disabled={r.status === "queued"} onClick={() => inputs.current[r.key + role]?.click()}>{r[field] ? "✓ Replace" : `Add ${l.toLowerCase()}`}</button>
                  </td>
                ))}
                <td className="small">
                  {r.status === "queued" ? <Link href={`/sessions/${r.id}`}>Queued — view</Link> : r.status}
                  {r.message && <div className="muted">{r.message}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted">No cards yet.</p>}
      </div>
      <div className="row">
        <button className="btn" onClick={() => addCard().catch((e) => setErr(e.message))}>+ Add card</button>
        <button className="btn primary" disabled={!ready || busy} onClick={analyzeAll}>{busy ? "Queuing…" : `Analyze ${ready} card${ready === 1 ? "" : "s"}`}</button>
      </div>
    </div>
  );
}
