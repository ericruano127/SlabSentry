"use client";
import type { Me } from "@/lib/client/hooks";
import { fmtDate, UpgradePrompt } from "./ui";

export function CreditSummary({ usage }: { usage: Me["usage"] }) {
  const paid = usage.planId !== "free";
  const used = paid ? usage.periodUsed : usage.freeUsed;
  const total = paid ? usage.periodAllowance : usage.freeGranted;
  const pct = total ? Math.min(100, (used / total) * 100) : 100;
  const low = paid && usage.periodRemaining <= Math.max(2, Math.ceil(total * 0.1));
  return (
    <div className="stack">
      <div className="grid grid-3">
        <div className="card"><div className="muted small">Current plan</div><div className="stat">{usage.planName}</div>{usage.billingInterval && <div className="small muted">Billed {usage.billingInterval === "year" ? "annually" : "monthly"}</div>}</div>
        <div className="card">
          <div className="muted small">Verification usage</div>
          <div className="stat">{used} / {total}<span className="small muted"> {paid ? "this month" : "free (lifetime)"}</span></div>
          <div className="meter" role="progressbar" aria-valuenow={used} aria-valuemax={total} aria-label="Verifications used"><span style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="card">
          <div className="muted small">Available</div>
          <div className="stat">{usage.totalRemaining}<span className="small muted"> remaining</span></div>
          <div className="small muted">{paid ? (usage.willCancel ? `Plan ends ${fmtDate(usage.accessEndsAt)} (no renewal)` : `Renews ${fmtDate(usage.renewsAt)} · allowance resets ${fmtDate(usage.windowEnd)}`) : "Free verifications never reset"}{paid && usage.freeRemaining > 0 ? ` · includes ${usage.freeRemaining} free` : ""}</div>
        </div>
      </div>
      {!paid && usage.freeRemaining === 0 && <UpgradePrompt reason="You've used your 3 free verifications." />}
      {low && <UpgradePrompt compact reason={`Only ${usage.periodRemaining} verification${usage.periodRemaining === 1 ? "" : "s"} left this month.`} />}
    </div>
  );
}
