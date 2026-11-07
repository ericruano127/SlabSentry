import type { FeatureKey, Plan } from "./plans";

export type SubStatus = "active" | "trialing" | "past_due" | "canceled" | "expired" | "refunded" | "paused" | "incomplete";
export type BillingProvider = "stripe" | "app_store" | "play_store" | "manual";

export interface SubscriptionState {
  id: string;
  planId: string;
  provider: BillingProvider;
  status: SubStatus;
  interval: "month" | "year";
  startedAt: string; // anchor for monthly allowance windows
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

/** Statuses that still grant paid access while the paid period runs. */
const ACCESS_STATUSES: SubStatus[] = ["active", "trialing", "past_due", "canceled"];

/** Grace for past_due (payment retry) before access stops. */
export const PAST_DUE_GRACE_DAYS = 3;

export function subscriptionGrantsAccess(s: SubscriptionState, now: Date): boolean {
  if (!ACCESS_STATUSES.includes(s.status)) return false;
  const end = new Date(s.currentPeriodEnd).getTime();
  if (s.status === "past_due") return now.getTime() < end + PAST_DUE_GRACE_DAYS * 864e5;
  return now.getTime() < end; // canceled keeps access until paid period ends
}

/** Pick the best granting subscription (highest plan rank) across all providers. */
export function resolveActiveSubscription(subs: SubscriptionState[], plans: Plan[], now: Date): SubscriptionState | null {
  const rank = (id: string) => plans.find((p) => p.id === id)?.rank ?? -1;
  return subs.filter((s) => subscriptionGrantsAccess(s, now)).sort((a, b) => rank(b.planId) - rank(a.planId))[0] ?? null;
}

function addMonthsClamped(anchor: Date, months: number): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return target;
}

/** Monthly allowance window containing `now`, anchored on the subscription start.
 * Used for both monthly and annual plans (annual = 12 monthly windows). */
export function allowanceWindow(anchorIso: string, now: Date): { start: Date; end: Date } {
  const anchor = new Date(anchorIso);
  if (now < anchor) return { start: anchor, end: addMonthsClamped(anchor, 1) };
  let months = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonthsClamped(anchor, months);
  if (start > now) start = addMonthsClamped(anchor, --months);
  return { start, end: addMonthsClamped(anchor, months + 1) };
}

export interface Entitlements {
  planId: string;
  planName: string;
  features: FeatureKey[];
  subscription: SubscriptionState | null;
  window: { start: string; end: string } | null;
  monthlyAllowance: number;
  renewsAt: string | null;
  willCancel: boolean;
}

export function computeEntitlements(subs: SubscriptionState[], plans: Plan[], now: Date): Entitlements {
  const free = plans.find((p) => p.id === "free")!;
  const sub = resolveActiveSubscription(subs, plans, now);
  const plan = (sub && plans.find((p) => p.id === sub.planId)) || free;
  const w = sub ? allowanceWindow(sub.startedAt, now) : null;
  return {
    planId: plan.id,
    planName: plan.name,
    features: plan.features,
    subscription: sub,
    window: w ? { start: w.start.toISOString(), end: w.end.toISOString() } : null,
    monthlyAllowance: sub ? plan.monthlyAllowance : 0,
    renewsAt: sub && !sub.cancelAtPeriodEnd && sub.status !== "canceled" ? sub.currentPeriodEnd : null,
    willCancel: !!sub && (sub.cancelAtPeriodEnd || sub.status === "canceled"),
  };
}

export function hasFeature(e: Pick<Entitlements, "features">, f: FeatureKey) {
  return e.features.includes(f);
}
