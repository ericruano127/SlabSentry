"use client";
import Link from "next/link";
import { useState } from "react";
import { CreditSummary } from "@/components/CreditSummary";
import { fmtDate } from "@/components/ui";
import { api, download } from "@/lib/client/api";
import { MfaSettings } from "@/components/MfaSettings";
import { useApi, type Me } from "@/lib/client/hooks";
import { devSignOut, supabase } from "@/lib/client/supabase";

export default function Account() {
  const me = useApi<Me & { user: { role: string; isStaff: boolean; mfa: boolean }; consent: any }>("/api/me");
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
      <section className="card stack" id="privacy">
        <h2>Privacy</h2>
        <p className="small muted">Location and camera details are removed from every photo when you upload it. We don't sell or share your personal information.</p>
        <label className="row" style={{ fontWeight: 400, alignItems: "flex-start" }}>
          <input type="checkbox" style={{ width: 22, minHeight: 22, marginTop: 2 }} checked={!!me.data.consent?.training.granted} onChange={async (e) => {
            try { await api("/api/consent", { method: "PATCH", json: { training: e.target.checked } }); me.reload(); } catch (err: any) { setMsg(err.message); }
          }} />
          <span>Use my future uploads to improve counterfeit detection. <Link href="/legal/training-consent">Details</Link>. Turning this off never limits features.</span>
        </label>
        <div className="row">
          <button className="btn" onClick={() => download("/api/account/export", "slabguard-data.zip").catch((e) => setMsg(e.message))}>Download my data</button>
          <Link className="btn" href="/legal/privacy">Privacy Policy</Link>
        </div>
        <p className="small muted">Accepted Terms v{me.data.consent?.terms.accepted ?? "—"} · Privacy v{me.data.consent?.privacy.accepted ?? "—"}</p>
      </section>
      <section className="card stack">
        <h2>Security</h2>
        <MfaSettings required={!!me.data.user.isStaff} />
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
