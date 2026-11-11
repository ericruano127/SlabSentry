"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function Admin() {
  const [days, setDays] = useState(30);
  const m = useApi<any>(`/api/admin/metrics?days=${days}`);
  const plans = useApi<any>("/api/admin/plans");
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const me = useApi<any>("/api/me");
  const [roleForm, setRoleForm] = useState({ email: "", role: "analyst", reason: "" });
  if (m.error?.body?.error === "mfa_required")
    return <div className="banner warn">Staff tools require two-factor authentication. <a href="/account">Enable it in Account → Security</a>, then sign in again.</div>;
  if (m.error) return <div className="banner bad">{m.error.message}</div>;
  if (!m.data) return <p className="muted">Loading…</p>;
  const d = m.data;
  const tiles: [string, string][] = [
    ["Registered users", String(d.users.total)], ["Paid / free", `${d.users.paid} / ${d.users.free}`], ["Free → paid", pct(d.conversion.freeToPaidRate)],
    ["MRR", usd(d.revenue.mrr)], ["ARR", usd(d.revenue.arr)], ["ARPPU (monthly)", usd(d.revenue.arppu)],
    ["Churned (window)", `${d.churn.churnedInWindow} · ${pct(d.churn.rate)}`], ["Pending cancellations", String(d.churn.pendingCancellations)],
    ["Verifications", `${d.verifications.total} (${d.verifications.billable} billable)`], ["Failed scans", pct(d.verifications.failedRate)],
    ["Avg cost / verification", usd(d.costs.avgPerVerification)], ["Avg contribution / verification", usd(d.margin.avgContributionPerVerification)],
    ["Refund rate", pct(d.payments.refundRate)], ["Disputes", String(d.payments.disputes)],
  ];
  return (
    <div className="stack">
      <div className="row spread"><h1>Admin · unit economics</h1>
        <select aria-label="Window" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 160 }}>{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></div>
      <p className="small muted">Internal only. {d.costs.note} · <a href="/admin/library">Reference library →</a> · <a href="/admin/templates">Verified templates & market data →</a> · <a href="/admin/quality">Quality & releases →</a></p>
      <div className="grid grid-3">{tiles.map(([k, v]) => <div key={k} className="card"><div className="small muted">{k}</div><div className="stat" style={{ fontSize: "1.5rem" }}>{v}</div></div>)}</div>
      <div className="grid grid-2">
        <section className="card scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><h2>Verifications by plan</h2><table className="table small"><thead><tr><th>Plan</th><th>Sessions</th><th>Billable</th><th>Failed</th></tr></thead><tbody>{d.verifications.byPlan.map((r: any) => <tr key={r.plan_id}><td>{r.plan_id}</td><td>{r.sessions}</td><td>{r.billable}</td><td>{r.failed}</td></tr>)}</tbody></table></section>
        <section className="card scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><h2>Average cost per verification</h2><table className="table small"><tbody>
          <tr><td>Compute (vision)</td><td>{usd(d.costs.avgCompute)}</td></tr><tr><td>OCR</td><td>{usd(d.costs.avgOcr)}</td></tr><tr><td>Image search</td><td>{usd(d.costs.avgImageSearch)}</td></tr>
          <tr><td>AI</td><td>{usd(d.costs.avgAi)}</td></tr><tr><td>Storage</td><td>{usd(d.costs.avgStorage)}</td></tr></tbody></table></section>
      </div>
      <section className="card stack">
        <h2>Plans & allowances</h2>
        <p className="small muted">Edit the JSON (prices in cents, allowances per month). Changes are audited and apply to current billing windows. Store product prices must also be changed in App Store Connect / Play Console / Stripe.</p>
        <textarea aria-label="Plans JSON" rows={14} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={draft || JSON.stringify(plans.data?.plans ?? [], null, 2)} onChange={(e) => setDraft(e.target.value)} />
        <input aria-label="Reason" placeholder="Reason for change (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn primary" disabled={!draft || reason.length < 3} onClick={async () => {
          try { await api("/api/admin/plans", { method: "PUT", json: { plans: JSON.parse(draft), reason } }); setMsg("Saved."); setDraft(""); plans.reload(); } catch (e: any) { setMsg(e.body?.issues ? JSON.stringify(e.body.issues) : e.message); }
        }}>Save plans</button>
        {msg && <div className="banner">{msg}</div>}
      </section>
      {me.data?.user.role === "owner" && (
        <section className="card stack">
          <h2>Staff roles</h2>
          <p className="small muted">Least privilege: support (users, privacy requests), analyst (metrics, read plans), admin (plans, library), owner (roles). All staff need two-factor authentication. Changes are audited.</p>
          <div className="row">
            <input aria-label="User email" placeholder="user@example.com" value={roleForm.email} onChange={(e) => setRoleForm({ ...roleForm, email: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
            <select aria-label="Role" value={roleForm.role} onChange={(e) => setRoleForm({ ...roleForm, role: e.target.value })} style={{ width: 140 }}>{["user", "support", "analyst", "admin", "owner"].map((r) => <option key={r}>{r}</option>)}</select>
            <input aria-label="Reason" placeholder="Reason" value={roleForm.reason} onChange={(e) => setRoleForm({ ...roleForm, reason: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn" disabled={!roleForm.email || roleForm.reason.length < 3} onClick={async () => {
              try { await api("/api/admin/users/role", { method: "PUT", json: roleForm }); setMsg(`Role updated: ${roleForm.email} → ${roleForm.role}`); } catch (e: any) { setMsg(e.message); }
            }}>Set role</button>
          </div>
        </section>
      )}
    </div>
  );
}
