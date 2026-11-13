import Stripe from "stripe";
import { one } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { loadSubscriptions } from "../credits";
import { processBillingEvent, recordPayment, upsertSubscription, type SubscriptionUpsert } from "./subscriptions";
import { subscriptionGrantsAccess } from "@slabguard/core";

/**
 * The Stripe API version the app speaks. Pinned explicitly so a library upgrade can't change it silently
 * (a new stripe package pins a different version and this line stops type-checking). Create the webhook
 * endpoint with the SAME version in the Stripe dashboard: events arrive in the endpoint's version.
 */
export const STRIPE_API_VERSION = "2026-10-28.endive" as const;

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!env.stripeSecret) throw new HttpError(503, "billing_not_configured", "Web billing is not configured yet.");
  return (client ??= new Stripe(env.stripeSecret, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 15_000 }));
}

/** Finds the invoice a PaymentIntent paid (charges and disputes no longer carry the invoice id). */
export type InvoiceFinder = (paymentIntentId: string) => Promise<string | null>;
const findInvoiceViaApi: InvoiceFinder = async (pi) => {
  const r = await stripe().invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
  const inv = r.data[0]?.invoice;
  return typeof inv === "string" ? inv : inv?.id ?? null;
};
const idOf = (x: unknown): string | null => (typeof x === "string" ? x : (x as { id?: string } | null)?.id ?? null);

/**
 * The `payments` row a charge or dispute belongs to. Subscription payments are recorded under their invoice id
 * (invoice.paid), so resolve the invoice: from the object itself on older API versions, else through the
 * PaymentIntent. An API failure throws, so Stripe redelivers the event; only "no invoice" falls back.
 */
async function paymentRowId(o: any, fallback: string, findInvoice: InvoiceFinder): Promise<string> {
  const direct = idOf(o.invoice);
  if (direct) return direct;
  const pi = idOf(o.payment_intent);
  return (pi && (await findInvoice(pi))) || fallback;
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error("stripe error", e);
    throw new HttpError(503, "billing_unavailable", "Our payment provider is temporarily unavailable. Your current plan and credits are unaffected — please try again shortly.");
  }
}

async function customerFor(userId: string, email: string | null) {
  const u = await one(`select stripe_customer_id from app_users where id=$1`, [userId]);
  if (u?.stripe_customer_id) return u.stripe_customer_id as string;
  const c = await stripe().customers.create({ email: email ?? undefined, metadata: { user_id: userId } }, { idempotencyKey: `customer-${userId}` });
  await one(`update app_users set stripe_customer_id=$2 where id=$1 and stripe_customer_id is null`, [userId, c.id]);
  return c.id;
}

export async function createCheckout(userId: string, email: string | null, priceId: string) {
  const price = await one(`select p.*, pl.active as plan_active from subscription_prices p join subscription_plans pl on pl.id=p.plan_id where p.id=$1 and p.active`, [priceId]);
  if (!price || !price.plan_active) throw new HttpError(400, "invalid_price", "That plan is not available.");
  if (!price.stripe_price_id) throw new HttpError(503, "billing_not_configured", "This plan is not yet purchasable on the web.");
  const now = new Date();
  const active = (await loadSubscriptions(userId)).filter((s) => subscriptionGrantsAccess(s, now));
  const store = active.find((s) => s.provider !== "stripe");
  if (store) throw new HttpError(409, "managed_elsewhere", `Your subscription is managed through ${store.provider === "app_store" ? "the App Store" : "Google Play"}. Change plans there to avoid double billing.`);
  if (active.some((s) => s.provider === "stripe")) throw new HttpError(409, "use_portal", "You already have a web subscription. Use Manage Subscription to change plans.");
  return guard(async () => {
    const customer = await customerFor(userId, email);
    const s = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: userId,
      line_items: [{ price: price.stripe_price_id, quantity: 1 }],
      subscription_data: { metadata: { user_id: userId } },
      allow_promotion_codes: true,
      success_url: `${env.appUrl}/dashboard?checkout=success`,
      cancel_url: `${env.appUrl}/pricing?checkout=canceled`,
    });
    return s.url!;
  });
}

export async function createPortal(userId: string) {
  const u = await one(`select stripe_customer_id from app_users where id=$1`, [userId]);
  if (!u?.stripe_customer_id) throw new HttpError(404, "no_web_subscription", "No web billing account found.");
  return guard(async () => (await stripe().billingPortal.sessions.create({ customer: u.stripe_customer_id, return_url: `${env.appUrl}/account` })).url);
}

const STATUS: Record<string, SubscriptionUpsert["status"]> = {
  active: "active", trialing: "trialing", past_due: "past_due", canceled: "expired", unpaid: "expired",
  incomplete: "incomplete", incomplete_expired: "expired", paused: "paused",
};

export async function subscriptionToUpsert(sub: Stripe.Subscription, eventCreated: number): Promise<SubscriptionUpsert | null> {
  const item = sub.items.data[0];
  const price = await one(`select id, plan_id, interval from subscription_prices where stripe_price_id=$1`, [item?.price.id]);
  let userId = sub.metadata?.user_id as string | undefined;
  if (!userId) userId = (await one(`select id from app_users where stripe_customer_id=$1`, [typeof sub.customer === "string" ? sub.customer : sub.customer.id]))?.id;
  if (!price || !userId) return null;
  const anyItem = item as unknown as { current_period_start?: number; current_period_end?: number };
  const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const ps = anyItem.current_period_start ?? legacy.current_period_start;
  const pe = anyItem.current_period_end ?? legacy.current_period_end;
  const iso = (n?: number | null) => (n ? new Date(n * 1000).toISOString() : null);
  return {
    userId,
    provider: "stripe",
    providerSubscriptionId: sub.id,
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    planId: price.plan_id,
    priceId: price.id,
    status: STATUS[sub.status] ?? "incomplete",
    interval: price.interval,
    startedAt: iso(sub.billing_cycle_anchor ?? sub.start_date)!,
    currentPeriodStart: iso(ps),
    currentPeriodEnd: iso(pe) ?? iso(sub.ended_at) ?? new Date().toISOString(),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
    providerTimestamp: new Date(eventCreated * 1000).toISOString(),
  };
}

/** Verified webhook entrypoint. */
export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  if (!env.stripeWebhookSecret) throw new HttpError(503, "billing_not_configured", "Stripe webhook secret missing");
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature ?? "", env.stripeWebhookSecret);
  } catch {
    throw new HttpError(400, "invalid_signature", "Invalid Stripe signature");
  }
  return applyStripeEvent(event);
}

/** Separated from signature verification so it can be exercised with mocked events. */
export async function applyStripeEvent(event: Stripe.Event, fetchSubscription?: (id: string) => Promise<Stripe.Subscription>, findInvoice: InvoiceFinder = findInvoiceViaApi) {
  return processBillingEvent("stripe", event.id, event.type, event, async () => {
    const o = event.data.object as any;
    switch (event.type) {
      case "checkout.session.completed": {
        if (o.mode !== "subscription" || !o.subscription) return "ignored";
        if (o.client_reference_id && o.customer) await one(`update app_users set stripe_customer_id=coalesce(stripe_customer_id,$2) where id=$1`, [o.client_reference_id, o.customer]);
        const fetch = fetchSubscription ?? ((id: string) => stripe().subscriptions.retrieve(id));
        const sub = await fetch(typeof o.subscription === "string" ? o.subscription : o.subscription.id);
        if (!sub.metadata?.user_id && o.client_reference_id) sub.metadata = { ...sub.metadata, user_id: o.client_reference_id };
        const up = await subscriptionToUpsert(sub, event.created);
        if (!up) throw new Error("unmapped subscription (price or user)");
        await upsertSubscription(up);
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        const up = await subscriptionToUpsert(o as Stripe.Subscription, event.created);
        if (!up) throw new Error("unmapped subscription (price or user)");
        await upsertSubscription(up);
        return;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const user = await one(`select id from app_users where stripe_customer_id=$1`, [o.customer]);
        const subId = o.subscription ?? o.parent?.subscription_details?.subscription ?? null;
        await recordPayment({ userId: user?.id ?? null, provider: "stripe", providerPaymentId: o.id, amountCents: o.amount_paid ?? o.amount_due ?? 0, currency: o.currency ?? "usd", status: event.type === "invoice.paid" ? "succeeded" : "failed", subscriptionProviderId: typeof subId === "string" ? subId : subId?.id, occurredAt: new Date(event.created * 1000).toISOString() });
        return;
      }
      case "charge.refunded": {
        const pid = await paymentRowId(o, o.id, findInvoice);
        const full = o.amount_refunded >= o.amount;
        await recordPayment({ userId: null, provider: "stripe", providerPaymentId: pid, amountCents: o.amount, refundedCents: o.amount_refunded, currency: o.currency, status: full ? "refunded" : "partially_refunded" });
        // Access follows the Stripe subscription state: the refund runbook cancels the subscription, which arrives as subscription.deleted.
        return;
      }
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        // won / warning_closed: the money stays. lost / prevented (refunded before it became a dispute): it went back.
        const lost = event.type === "charge.dispute.closed" && (o.status === "lost" || o.status === "prevented");
        const status = event.type === "charge.dispute.created" ? "disputed" : lost ? "dispute_lost" : "dispute_won";
        const pid = await paymentRowId(o, idOf(o.charge) ?? `dispute:${o.id}`, findInvoice);
        const updated = await one(
          `update payments set status=$2, refunded_cents=case when $3 then greatest(refunded_cents, amount_cents) else refunded_cents end
            where provider='stripe' and provider_payment_id=$1 returning id`, [pid, status, lost]);
        // No payment on record (e.g. its invoice event hasn't arrived): note the dispute without adding revenue.
        if (!updated) await recordPayment({ userId: null, provider: "stripe", providerPaymentId: pid, amountCents: 0, refundedCents: 0, currency: o.currency, status });
        return;
      }
      default:
        return "ignored";
    }
  });
}
