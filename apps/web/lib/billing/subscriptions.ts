import { lockUser, one, tx, type Q } from "../db";
import { entitlementsFor } from "../credits";

export interface SubscriptionUpsert {
  userId: string;
  provider: "stripe" | "app_store" | "play_store" | "manual";
  providerSubscriptionId: string;
  providerCustomerId?: string | null;
  planId: string;
  priceId?: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "expired" | "refunded" | "paused" | "incomplete";
  interval: "month" | "year";
  startedAt: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  providerTimestamp: string; // event time; older updates are ignored (out-of-order delivery)
}

/** Apply a provider's subscription state. Returns false if ignored as stale. */
export async function upsertSubscription(s: SubscriptionUpsert, cx?: Q): Promise<boolean> {
  const run = async (c: Q) => {
    await lockUser(c, s.userId);
    const res = await c.query(
      `insert into user_subscriptions (user_id,plan_id,price_id,provider,provider_subscription_id,provider_customer_id,status,billing_interval,started_at,current_period_start,current_period_end,cancel_at_period_end,provider_updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (provider, provider_subscription_id) do update set
         plan_id=excluded.plan_id, price_id=excluded.price_id, status=excluded.status, billing_interval=excluded.billing_interval,
         started_at=excluded.started_at, current_period_start=excluded.current_period_start, current_period_end=excluded.current_period_end,
         cancel_at_period_end=excluded.cancel_at_period_end, provider_customer_id=coalesce(excluded.provider_customer_id, user_subscriptions.provider_customer_id),
         provider_updated_at=excluded.provider_updated_at, updated_at=now()
       where user_subscriptions.provider_updated_at is null or user_subscriptions.provider_updated_at <= excluded.provider_updated_at`,
      [s.userId, s.planId, s.priceId ?? null, s.provider, s.providerSubscriptionId, s.providerCustomerId ?? null, s.status, s.interval, s.startedAt, s.currentPeriodStart ?? null, s.currentPeriodEnd, s.cancelAtPeriodEnd, s.providerTimestamp],
    );
    await recomputeEntitlements(s.userId, c);
    return (res.rowCount ?? 0) > 0;
  };
  return cx ? run(cx) : tx(run);
}

/** Materialize the user's entitlements (one internal system across all stores). */
export async function recomputeEntitlements(userId: string, c: Q, now = new Date()) {
  const { ent } = await entitlementsFor(userId, c, now);
  await c.query(
    `insert into account_entitlements (user_id,plan_id,source_subscription_id,features,monthly_allowance,window_start,window_end,renews_at,will_cancel,computed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     on conflict (user_id) do update set plan_id=excluded.plan_id, source_subscription_id=excluded.source_subscription_id, features=excluded.features,
       monthly_allowance=excluded.monthly_allowance, window_start=excluded.window_start, window_end=excluded.window_end, renews_at=excluded.renews_at,
       will_cancel=excluded.will_cancel, computed_at=now()`,
    [userId, ent.planId, ent.subscription?.id ?? null, JSON.stringify(ent.features), ent.monthlyAllowance, ent.window?.start ?? null, ent.window?.end ?? null, ent.renewsAt, ent.willCancel],
  );
  // Keep the current window's grant in step with the plan (upgrade = more now; downgrade clamps remaining at 0).
  if (ent.window) {
    await c.query(
      `insert into verification_allowances (user_id,kind,plan_id,subscription_id,period_start,period_end,granted) values ($1,'subscription_period',$2,$3,$4,$5,$6)
       on conflict (user_id,kind,period_start) do update set granted=excluded.granted, plan_id=excluded.plan_id, subscription_id=excluded.subscription_id`,
      [userId, ent.planId, ent.subscription!.id, ent.window.start, ent.window.end, ent.monthlyAllowance],
    );
  }
  return ent;
}

/**
 * Idempotent event processing. Duplicate deliveries of a processed event are
 * no-ops; events that previously failed are retried.
 */
export async function processBillingEvent(
  provider: string,
  eventId: string,
  type: string,
  payload: unknown,
  handler: () => Promise<string | void>,
): Promise<{ duplicate: boolean; status: string }> {
  const inserted = await one(
    `insert into billing_events (provider,provider_event_id,event_type,payload,attempts) values ($1,$2,$3,$4,1)
     on conflict (provider,provider_event_id) do nothing returning id`,
    [provider, eventId, type, JSON.stringify(payload)],
  );
  let id: string | undefined = inserted?.id;
  if (!id) {
    // Seen before: processed → duplicate; failed or stuck (>5 min) → reclaim atomically; otherwise in progress.
    const reclaimed = await one(
      `update billing_events set attempts=attempts+1, status='received', received_at=now()
        where provider=$1 and provider_event_id=$2 and (status='failed' or (status='received' and received_at < now() - interval '5 minutes'))
        returning id`,
      [provider, eventId],
    );
    if (!reclaimed) {
      const existing = await one(`select status from billing_events where provider=$1 and provider_event_id=$2`, [provider, eventId]);
      return { duplicate: true, status: existing?.status === "received" ? "in_progress" : existing?.status };
    }
    id = reclaimed.id;
  }
  const row = { id };
  try {
    const result = await handler();
    const status = result === "ignored" ? "ignored" : "processed";
    await one(`update billing_events set status=$2, processed_at=now(), error=null where id=$1`, [row.id, status]);
    return { duplicate: false, status };
  } catch (e) {
    await one(`update billing_events set status='failed', error=$2 where id=$1`, [row.id, String((e as Error).message).slice(0, 500)]);
    throw e;
  }
}

export async function recordPayment(p: {
  userId: string | null; provider: string; providerPaymentId: string; amountCents: number; currency: string;
  status: string; subscriptionProviderId?: string | null; refundedCents?: number; occurredAt?: string;
}) {
  await one(
    `insert into payments (user_id,subscription_id,provider,provider_payment_id,amount_cents,refunded_cents,currency,status,occurred_at)
     values ($1,(select id from user_subscriptions where provider=$2 and provider_subscription_id=$9),$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()))
     on conflict (provider,provider_payment_id) do update set status=excluded.status, refunded_cents=greatest(payments.refunded_cents, excluded.refunded_cents),
       amount_cents=greatest(payments.amount_cents, excluded.amount_cents)`,
    [p.userId, p.provider, p.providerPaymentId, p.amountCents, p.refundedCents ?? 0, p.currency.toUpperCase(), p.status, p.occurredAt ?? null, p.subscriptionProviderId ?? null],
  );
}
