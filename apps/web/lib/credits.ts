import { allowanceWindow, computeEntitlements, type Entitlements, type Plan, type SubscriptionState } from "@slabguard/core";
import { lockUser, one, q, tx, type Q } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { loadPlans } from "./plans";

/**
 * Verification credit ledger.
 *
 * One credit = one slab session. Lifecycle per session attempt:
 *   none ──reserve──► reserved ──consume──► consumed      (report delivered)
 *                        └──────release──► released       (any failure; retry may reserve again)
 * Every transition takes a per-user advisory lock and a ledger row keyed by
 * (session, attempt, action), so retries / duplicate calls / concurrency cannot
 * double-charge. Re-analysis of a consumed session (retakes) is free.
 */

export async function loadSubscriptions(userId: string, c?: Q): Promise<SubscriptionState[]> {
  const rows = await q(`select * from user_subscriptions where user_id=$1`, [userId], c);
  return rows.map((r) => ({
    id: r.id, planId: r.plan_id, provider: r.provider, status: r.status, interval: r.billing_interval,
    startedAt: r.started_at, currentPeriodEnd: r.current_period_end, cancelAtPeriodEnd: r.cancel_at_period_end,
  }));
}

export async function entitlementsFor(userId: string, c?: Q, now = new Date()): Promise<{ ent: Entitlements; plans: Plan[] }> {
  const plans = await loadPlans(c);
  return { ent: computeEntitlements(await loadSubscriptions(userId, c), plans, now), plans };
}

/** Ensure the allowance row for the current subscription window exists and reflects the current plan. */
async function currentPeriodAllowance(c: Q, userId: string, ent: Entitlements) {
  if (!ent.subscription || !ent.window) return null;
  return one(
    `insert into verification_allowances (user_id,kind,plan_id,subscription_id,period_start,period_end,granted)
     values ($1,'subscription_period',$2,$3,$4,$5,$6)
     on conflict (user_id,kind,period_start) do update
       set granted=excluded.granted, plan_id=excluded.plan_id, subscription_id=excluded.subscription_id, period_end=excluded.period_end
     returning *`,
    [userId, ent.planId, ent.subscription.id, ent.window.start, ent.window.end, ent.monthlyAllowance],
    c,
  );
}

export interface UsageSummary {
  planId: string;
  planName: string;
  features: string[];
  periodAllowance: number;
  periodUsed: number;
  periodReserved: number;
  periodRemaining: number;
  windowStart: string | null;
  windowEnd: string | null;
  freeGranted: number;
  freeUsed: number;
  freeRemaining: number;
  totalRemaining: number;
  renewsAt: string | null;
  willCancel: boolean;
  accessEndsAt: string | null;
  subscriptionProvider: string | null;
  billingInterval: string | null;
}

export async function usageSummary(userId: string, c?: Q, now = new Date()): Promise<UsageSummary> {
  const run = async (cx: Q) => {
    const { ent } = await entitlementsFor(userId, cx, now);
    const period = await currentPeriodAllowance(cx, userId, ent);
    const free = await one(`select * from verification_allowances where user_id=$1 and kind='lifetime_free'`, [userId], cx);
    const grants = await q(`select coalesce(sum(granted-used-reserved),0)::int as rem from verification_allowances where user_id=$1 and kind='admin_grant' and (period_end is null or period_end > $2)`, [userId, now.toISOString()], cx);
    const pr = period ? Math.max(0, period.granted - period.used - period.reserved) : 0;
    const fr = free ? Math.max(0, free.granted - free.used - free.reserved) : 0;
    return {
      planId: ent.planId, planName: ent.planName, features: ent.features,
      periodAllowance: period?.granted ?? 0, periodUsed: period?.used ?? 0, periodReserved: period?.reserved ?? 0, periodRemaining: pr,
      windowStart: ent.window?.start ?? null, windowEnd: ent.window?.end ?? null,
      freeGranted: free?.granted ?? 0, freeUsed: free?.used ?? 0, freeRemaining: fr,
      totalRemaining: pr + fr + (grants[0]?.rem ?? 0),
      renewsAt: ent.renewsAt, willCancel: ent.willCancel, accessEndsAt: ent.subscription?.currentPeriodEnd ?? null,
      subscriptionProvider: ent.subscription?.provider ?? null, billingInterval: ent.subscription?.interval ?? null,
    };
  };
  return c ? run(c) : tx(run);
}

export type ReserveResult = { status: "reserved" | "already_reserved" | "already_consumed"; allowanceId: string | null; attempt: number };

export async function reserveCredit(userId: string, sessionId: string, now = new Date()): Promise<ReserveResult> {
  return tx(async (c) => {
    await lockUser(c, userId);
    await releaseStaleReservations(c, userId, now);
    const s = await one(`select * from verification_sessions where id=$1 and user_id=$2 for update`, [sessionId, userId], c);
    if (!s) throw new HttpError(404, "not_found", "Session not found");
    if (s.credit_state === "consumed") return { status: "already_consumed", allowanceId: s.allowance_id, attempt: s.credit_attempt };
    if (s.credit_state === "reserved") return { status: "already_reserved", allowanceId: s.allowance_id, attempt: s.credit_attempt };

    const { ent } = await entitlementsFor(userId, c, now);
    await currentPeriodAllowance(c, userId, ent);
    // Order: current subscription window → admin grants → lifetime free credits.
    const a = await one(
      `select * from verification_allowances
        where user_id=$1 and granted - used - reserved > 0
          and ((kind='subscription_period' and period_start=$2) or (kind='admin_grant' and (period_end is null or period_end > $3)) or kind='lifetime_free')
        order by case kind when 'subscription_period' then 0 when 'admin_grant' then 1 else 2 end
        limit 1 for update`,
      [userId, ent.window?.start ?? "1900-01-01", now.toISOString()],
      c,
    );
    if (!a) {
      throw new HttpError(402, "limit_reached", ent.subscription ? "You've used all verifications for this billing month." : "You've used your 3 free verifications.", {
        planId: ent.planId,
        resetsAt: ent.window?.end ?? null,
        upgrade: true,
      });
    }
    const attempt = s.credit_attempt + 1;
    await c.query(`update verification_allowances set reserved = reserved + 1 where id=$1`, [a.id]);
    await c.query(`insert into verification_usage_ledger (user_id,session_id,allowance_id,attempt,action) values ($1,$2,$3,$4,'reserve')`, [userId, sessionId, a.id, attempt]);
    await c.query(`update verification_sessions set credit_state='reserved', credit_attempt=$2, allowance_id=$3, reserved_at=$4, updated_at=now() where id=$1`, [sessionId, attempt, a.id, now.toISOString()]);
    return { status: "reserved", allowanceId: a.id, attempt };
  });
}

/** Mark the credit used. Call only after a substantive report has been persisted. */
export async function consumeCredit(userId: string, sessionId: string) {
  return transition(userId, sessionId, "consume");
}

/** Return the reserved credit (failure before a report was delivered). */
export async function releaseCredit(userId: string, sessionId: string, reason: string) {
  return transition(userId, sessionId, "release", reason);
}

async function transition(userId: string, sessionId: string, action: "consume" | "release", reason?: string, cx?: Q) {
  const run = async (c: Q) => {
    await lockUser(c, userId);
    const s = await one(`select * from verification_sessions where id=$1 and user_id=$2 for update`, [sessionId, userId], c);
    if (!s || s.credit_state !== "reserved") return false; // idempotent no-op
    const ins = await c.query(
      `insert into verification_usage_ledger (user_id,session_id,allowance_id,attempt,action,reason) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [userId, sessionId, s.allowance_id, s.credit_attempt, action, reason ?? null],
    );
    if (!ins.rowCount) return false;
    if (s.allowance_id)
      await c.query(
        action === "consume"
          ? `update verification_allowances set reserved = greatest(reserved - 1, 0), used = used + 1 where id=$1`
          : `update verification_allowances set reserved = greatest(reserved - 1, 0) where id=$1`,
        [s.allowance_id],
      );
    await c.query(`update verification_sessions set credit_state=$2, updated_at=now() where id=$1`, [sessionId, action === "consume" ? "consumed" : "released"]);
    return true;
  };
  return cx ? run(cx) : tx(run);
}

/** Reservations orphaned by crashed workers are returned to the user. */
export async function releaseStaleReservations(c: Q, userId: string, now = new Date()) {
  const stale = await q(
    `select id from verification_sessions where user_id=$1 and credit_state='reserved' and status not in ('processing') and reserved_at < $2::timestamptz - make_interval(mins => $3)`,
    [userId, now.toISOString(), env.reservationTtlMinutes],
    c,
  );
  for (const s of stale) await transition(userId, s.id, "release", "stale_reservation", c);
}

/** Refund a consumed credit (e.g. admin decision, report later found unusable). */
export async function refundConsumedCredit(userId: string, sessionId: string, reason: string) {
  return tx(async (c) => {
    await lockUser(c, userId);
    const s = await one(`select * from verification_sessions where id=$1 and user_id=$2 for update`, [sessionId, userId], c);
    if (!s || s.credit_state !== "consumed") return false;
    const ins = await c.query(`insert into verification_usage_ledger (user_id,session_id,allowance_id,attempt,action,reason) values ($1,$2,$3,$4,'release',$5) on conflict do nothing`, [userId, sessionId, s.allowance_id, s.credit_attempt, reason]);
    if (!ins.rowCount) return false;
    if (s.allowance_id) await c.query(`update verification_allowances set used = greatest(used - 1, 0) where id=$1`, [s.allowance_id]);
    await c.query(`update verification_sessions set credit_state='released' where id=$1`, [sessionId]);
    return true;
  });
}

export { allowanceWindow };
