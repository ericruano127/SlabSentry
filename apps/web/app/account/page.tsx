"use client";
import Link from "next/link";
import { useState } from "react";
import { CreditSummary } from "@/components/CreditSummary";
import { fmtDate } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useApi, type Me } from "@/lib/client/hooks";
import { devSignOut, supabase } from "@/lib/client/supabase";

export default function Account() {
  const me = useApi<Me>("/api/me");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!me.data) return <p className="muted">Loading…</p>;
  const u = me.data.usage;
  const portal = async () => {
    try { location.href = (await api("/api/billing/portal", { method: "POST" })).url; } catch (e: any) { setMsg(e.message); }
  };
  const del = async () => {
    try {
      const r = await api("/api/account", { method: "DELETE", json: { confirm } });
      await supabase()?.auth.signOut();
      devSignOut();
      alert(`Account deleted.${r.storeSubscriptionsNote ? " " + r.storeSubscriptionsNote : ""}`);
      location.href = "/";
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="stack">
      <h1>Account</h1>
      <p className="muted">{me.data.user.email}</p>
      <CreditSummary usage={u} />
      <section className="card stack">
        <h2>Subscription</h2>
        {u.planId === "free" ? <p>You're on the Free plan. <Link href="/pricing">Compare plans</Link></p> : (
          <>
            <p>{u.planName} · billed {u.billingInterval === "year" ? "annually" : "monthly"} via {{ stripe: "web (Stripe)", app_store: "App Store", play_store: "Google Play", manual: "admin grant" }[u.subscriptionProvider ?? "manual"]}.</p>
            <p className="small muted">{u.willCancel ? `Canceled — access continues until ${fmtDate(u.accessEndsAt)}. Your reports stay available afterwards.` : `Renews ${fmtDate(u.renewsAt)}.`}</p>
            {u.subscriptionProvider === "stripe" ? <button className="btn" onClick={portal}>Manage, change plan or cancel</button>
              : <p className="small">Manage or cancel in your phone's {u.subscriptionProvider === "app_store" ? "App Store subscriptions (Settings → Apple ID → Subscriptions)" : "Google Play subscriptions"}.</p>}
          </>
        )}
        {msg && <div className="banner bad">{msg}</div>}
      </section>
      <section className="card stack">
        <h2>Security</h2>
        <div className="row"><Link className="btn" href="/reset-password">Change password</Link><button className="btn" onClick={async () => { await supabase()?.auth.signOut({ scope: "global" }); devSignOut(); location.href = "/login"; }}>Sign out of all devices</button></div>
      </section>
      <section className="card stack">
        <h2>Delete account</h2>
        <p className="small muted">Permanently deletes your account, photos and reports. Web subscriptions are canceled. App Store / Google Play subscriptions must be canceled in the store.</p>
        <div className="row"><input aria-label="Type DELETE to confirm" placeholder="Type DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ maxWidth: 200 }} /><button className="btn danger" disabled={confirm !== "DELETE"} onClick={del}>Delete account</button></div>
      </section>
    </div>
  );
}
