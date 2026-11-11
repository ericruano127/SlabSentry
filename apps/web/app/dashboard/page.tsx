"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CreditSummary } from "@/components/CreditSummary";
import { AssessmentPill, fmtDate } from "@/components/ui";
import { useApi, type Me } from "@/lib/client/hooks";

export default function Dashboard() {
  const me = useApi<Me>("/api/me");
  const list = useApi<{ sessions: any[] }>("/api/sessions");
  const [welcome, setWelcome] = useState(false);
  const [checkout, setCheckout] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setWelcome(p.has("welcome"));
    setCheckout(p.get("checkout"));
  }, []);
  if (me.error) return <div className="banner bad">{me.error.message}</div>;
  if (!me.data) return <p className="muted">Loading…</p>;
  const { usage, user } = me.data;
  return (
    <div className="stack">
      {(welcome || me.data.welcome) && usage.planId === "free" && usage.freeUsed === 0 && (
        <div className="banner ok" role="status"><strong>Welcome! Your first three slab verifications are free. No credit card required.</strong></div>
      )}
      {checkout === "success" && <div className="banner ok" role="status">Thanks! Your subscription is being activated — this can take a few seconds. <button className="btn" onClick={() => me.reload()}>Refresh</button></div>}
      <div className="row spread">
        <div><h1>Welcome back</h1><p className="muted">{user.email}</p></div>
        <Link className="btn primary" href="/scan">Scan new slab</Link>
      </div>
      <CreditSummary usage={usage} />
      <div className="row">
        <Link className="btn" href="/history">View verification history</Link>
        <Link className="btn" href="/account">Manage subscription</Link>
        {usage.planId !== "power" && <Link className="btn" href="/pricing">Upgrade plan</Link>}
        <Link className="btn" href="/history?download=1">Download reports</Link>
        {usage.features.includes("bulk_verification") && <Link className="btn" href="/bulk">Bulk queue</Link>}
        {(user as any).isStaff && <Link className="btn" href="/admin">Staff tools</Link>}
      </div>
      <section className="card">
        <div className="row spread"><h2>Recent verifications</h2><Link href="/history" className="small">All</Link></div>
        {list.data?.sessions.length ? (
          <div className="scroll-x" tabIndex={0} role="region" aria-label="Scrollable table"><table className="table">
            <thead><tr><th>Slab</th><th>Assessment</th><th>Date</th></tr></thead>
            <tbody>{list.data.sessions.slice(0, 6).map((s) => (
              <tr key={s.id}><td><Link href={s.status === "draft" ? `/scan?session=${s.id}` : `/sessions/${s.id}`}>{s.title ?? (s.cert_number ? `${s.grader ?? ""} ${s.cert_number}` : "Draft scan")}</Link></td><td><AssessmentPill value={s.overall_assessment} /></td><td className="small muted">{fmtDate(s.created_at)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">No scans yet. <Link href="/scan">Scan your first slab</Link>.</p>}
      </section>
    </div>
  );
}
