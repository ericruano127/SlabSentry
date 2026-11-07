"use client";
import { PlanCards } from "@/components/PlanCards";
import { useApi, type Me } from "@/lib/client/hooks";
import { hasDevSession, supabase } from "@/lib/client/supabase";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export default function Pricing() {
  const plans = useApi<{ plans: any[] }>("/api/plans");
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    (async () => {
      const signedIn = hasDevSession() || !!(await supabase()?.auth.getSession())?.data.session;
      if (signedIn) setMe(await api<Me>("/api/me").catch(() => null));
    })();
  }, []);
  return (
    <div className="stack">
      <div style={{ textAlign: "center" }}><h1>Plans for every collector</h1><p className="muted">Start free. Upgrade when you verify more slabs.</p></div>
      {me && <p style={{ textAlign: "center" }} className="small">You have <strong>{me.usage.totalRemaining}</strong> verifications available on <strong>{me.usage.planName}</strong>.</p>}
      {plans.data ? <PlanCards plans={plans.data.plans} me={me} /> : <p className="muted">Loading plans…</p>}
    </div>
  );
}
