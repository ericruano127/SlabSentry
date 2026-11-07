"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import type { Me } from "@/lib/client/hooks";

type Price = { id: string; interval: "month" | "year"; amountCents: number; currency: string; webPurchasable: boolean };
type Plan = { id: string; name: string; tagline: string; rank: number; monthlyAllowance: number; lifetimeAllowance: number; marketingBullets: string[]; prices: Price[] };

const money = (c: number, cur = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(c / 100);

export function PlanCards({ plans, me }: { plans: Plan[]; me: Me | null }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = me?.usage.planId;
  const currentRank = plans.find((p) => p.id === current)?.rank ?? 0;
  const provider = me?.usage.subscriptionProvider;

  async function choose(plan: Plan, price?: Price) {
    setErr(null);
    if (!me) return void (location.href = "/signup");
    setBusy(plan.id);
    try {
      // Existing web subscribers change plans in the Stripe portal (handles proration and scheduled downgrades).
      if (provider === "stripe" || (plan.id === "free" && provider === "stripe")) location.href = (await api("/api/billing/portal", { method: "POST" })).url;
      else if (price) location.href = (await api("/api/billing/checkout", { method: "POST", json: { priceId: price.id } })).url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.body?.message ?? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const yearSaving = (p: Plan) => {
    const m = p.prices.find((x) => x.interval === "month"), y = p.prices.find((x) => x.interval === "year");
    return m && y ? Math.round((1 - y.amountCents / (m.amountCents * 12)) * 100) : 0;
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "center" }}>
        <div className="toggle" role="group" aria-label="Billing period">
          <button className={interval === "month" ? "on" : ""} aria-pressed={interval === "month"} onClick={() => setInterval("month")}>Monthly</button>
          <button className={interval === "year" ? "on" : ""} aria-pressed={interval === "year"} onClick={() => setInterval("year")}>Annual{plans.some(yearSaving) ? ` · save up to ${Math.max(...plans.map(yearSaving))}%` : ""}</button>
        </div>
      </div>
      {err && <div className="banner bad" role="alert">{err}</div>}
      {provider && provider !== "stripe" && <div className="banner">Your subscription is managed through {provider === "app_store" ? "the App Store" : "Google Play"}. Change or cancel it in the store on your phone.</div>}
      <div className="grid grid-3">
        {plans.map((p) => {
          const price = p.prices.find((x) => x.interval === interval);
          const isCurrent = p.id === current;
          const featured = p.id === "pro";
          let cta = p.id === "free" ? "Start free" : "Choose plan";
          if (me) cta = isCurrent ? "Current plan" : p.rank > currentRank ? "Upgrade" : "Downgrade";
          const disabled = isCurrent || !!busy || (!!provider && provider !== "stripe") || (p.id !== "free" && !price?.webPurchasable && provider !== "stripe") || (p.id === "free" && !provider);
          return (
            <div key={p.id} className={`card plan ${featured ? "featured" : ""}`}>
              {featured && <span className="pill ok" style={{ position: "absolute", top: 14, right: 14 }}>Most popular</span>}
              <h2>{p.name}</h2>
              <p className="muted small">{p.tagline}</p>
              <div className="price">{p.id === "free" ? "$0" : price ? money(price.amountCents, price.currency) : "—"}<span className="small muted">{p.id === "free" ? "" : interval === "month" ? " /month" : " /year"}</span></div>
              <p className="small muted">{p.id === "free" ? `${p.lifetimeAllowance} lifetime verifications` : `${p.monthlyAllowance} verifications every month${interval === "year" ? " (allowance renews monthly)" : ""}`}</p>
              <ul className="small">{p.marketingBullets.map((b) => <li key={b}>{b}</li>)}</ul>
              {isCurrent && <span className="pill" style={{ marginBottom: 8 }}>Your plan</span>}
              <button className={`btn block ${featured && !isCurrent ? "primary" : ""}`} disabled={disabled} onClick={() => choose(p, price)}>{busy === p.id ? "Opening…" : cta}</button>
              {p.id !== "free" && price && !price.webPurchasable && <p className="small muted">Available in the mobile app.</p>}
            </div>
          );
        })}
      </div>
      <p className="small muted" style={{ textAlign: "center" }}>
        Subscriptions renew automatically at the price shown until canceled. Cancel anytime; you keep access until the end of the paid period. Unused monthly verifications don't roll over. Free verifications never reset. Taxes may apply. Verification reports are photographic screenings and cannot guarantee authenticity.
      </p>
    </div>
  );
}
