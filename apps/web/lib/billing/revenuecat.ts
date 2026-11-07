import { timingSafeEqual } from "node:crypto";
import { one } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { processBillingEvent, recordPayment, upsertSubscription, type SubscriptionUpsert } from "./subscriptions";

/**
 * Native subscriptions (StoreKit / Google Play Billing) are purchased through
 * RevenueCat's SDK in the mobile app. RevenueCat validates receipts with Apple
 * and Google; we accept its authenticated webhooks and, when a secret API key
 * is configured, reconcile from its REST API (source of truth) rather than
 * trusting event bodies. app_user_id === our user id (set via Purchases.logIn).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorized(header: string | null) {
  if (!env.revenuecatWebhookAuth || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(env.revenuecatWebhookAuth);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function priceForProduct(productId: string, store: string) {
  const col = store === "PLAY_STORE" ? "google_product_id" : "apple_product_id";
  // Google products may arrive as "subscription:baseplan" or just "subscription".
  return one(`select id, plan_id, interval from subscription_prices where ${col}=$1 or ${col} like $1 || ':%' order by (${col}=$1) desc limit 1`, [productId]);
}

const providerFor = (store: string): SubscriptionUpsert["provider"] | null => (store === "APP_STORE" || store === "MAC_APP_STORE" ? "app_store" : store === "PLAY_STORE" ? "play_store" : null);

export async function handleRevenueCatWebhook(body: any, authHeader: string | null) {
  if (!authorized(authHeader)) throw new HttpError(401, "unauthorized", "Invalid webhook authorization");
  const e = body?.event;
  if (!e?.id || !e?.type) throw new HttpError(400, "invalid_event", "Missing event");
  return applyRevenueCatEvent(e);
}

export async function applyRevenueCatEvent(e: any, fetchSubscriber: (uid: string) => Promise<any> = fetchRcSubscriber) {
  return processBillingEvent("revenuecat", e.id, e.type, e, async () => {
    if (e.type === "TEST" || e.environment === "SANDBOX" && env.isProd && process.env.ALLOW_SANDBOX_PURCHASES !== "1") return "ignored";
    const userId = [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].find((x: string) => UUID.test(x ?? ""));
    if (!userId) return "ignored"; // anonymous RC user; reconciled after login via /api/billing/sync
    if (env.revenuecatSecretKey) {
      await reconcileRevenueCat(userId, fetchSubscriber, e.event_timestamp_ms);
    } else {
      await applyEventDirect(userId, e);
    }
    if ((e.type === "INITIAL_PURCHASE" || e.type === "RENEWAL" || e.type === "NON_RENEWING_PURCHASE") && e.transaction_id) {
      await recordPayment({ userId, provider: providerFor(e.store) ?? "revenuecat", providerPaymentId: e.transaction_id, amountCents: Math.round((e.price_in_purchased_currency ?? e.price ?? 0) * 100), currency: e.currency ?? "USD", status: "succeeded", subscriptionProviderId: `${userId}:${e.product_id}`, occurredAt: new Date(e.purchased_at_ms ?? Date.now()).toISOString() });
    }
    if (e.type === "CANCELLATION" && e.cancel_reason === "CUSTOMER_SUPPORT" && e.transaction_id) {
      await one(`update payments set status='refunded', refunded_cents=amount_cents where provider=$1 and provider_payment_id=$2`, [providerFor(e.store), e.transaction_id]);
    }
  });
}

async function applyEventDirect(userId: string, e: any) {
  const provider = providerFor(e.store);
  if (!provider || !e.product_id) return;
  const price = await priceForProduct(e.new_product_id ?? e.product_id, e.store);
  if (!price) throw new Error(`unknown product ${e.product_id}`);
  const end = new Date(e.expiration_at_ms ?? Date.now()).toISOString();
  let status: SubscriptionUpsert["status"] = "active";
  let cancel = false;
  switch (e.type) {
    case "CANCELLATION":
      if (e.cancel_reason === "CUSTOMER_SUPPORT") status = "refunded";
      else (status = "canceled"), (cancel = true);
      break;
    case "EXPIRATION": status = "expired"; break;
    case "BILLING_ISSUE": status = "past_due"; break;
    case "SUBSCRIPTION_PAUSED": status = "paused"; break;
  }
  await upsertSubscription({
    userId, provider, providerSubscriptionId: `${userId}:${e.product_id}`, planId: price.plan_id, priceId: price.id, status,
    interval: price.interval, startedAt: new Date(e.original_purchased_at_ms ?? e.purchased_at_ms ?? Date.now()).toISOString(),
    currentPeriodStart: e.purchased_at_ms ? new Date(e.purchased_at_ms).toISOString() : null, currentPeriodEnd: end, cancelAtPeriodEnd: cancel,
    providerTimestamp: new Date(e.event_timestamp_ms ?? Date.now()).toISOString(),
  });
}

export async function fetchRcSubscriber(userId: string) {
  if (!env.revenuecatSecretKey) throw new HttpError(503, "billing_not_configured", "Mobile purchase sync is not configured.");
  const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${env.revenuecatSecretKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new HttpError(503, "billing_unavailable", "The app store sync service is temporarily unavailable. Your current access is unaffected.");
  return (await r.json()).subscriber;
}

/** Server-side "Restore Purchases": pull the subscriber from RevenueCat and apply every store subscription. */
export async function reconcileRevenueCat(userId: string, fetchSubscriber = fetchRcSubscriber, eventTsMs?: number) {
  const sub = await fetchSubscriber(userId);
  const ts = new Date(eventTsMs ?? Date.now()).toISOString();
  let applied = 0;
  for (const [productId, s] of Object.entries<any>(sub?.subscriptions ?? {})) {
    const provider = providerFor(s.store);
    if (!provider) continue;
    const price = await priceForProduct(productId, s.store);
    if (!price) continue;
    const expires = s.expires_date ? new Date(s.expires_date) : new Date(0);
    const now = Date.now();
    let status: SubscriptionUpsert["status"];
    if (s.refunded_at) status = "refunded";
    else if (expires.getTime() <= now && !(s.grace_period_expires_date && new Date(s.grace_period_expires_date).getTime() > now)) status = "expired";
    else if (s.billing_issues_detected_at) status = "past_due";
    else if (s.unsubscribe_detected_at) status = "canceled";
    else status = "active";
    await upsertSubscription({
      userId, provider, providerSubscriptionId: `${userId}:${productId}`, planId: price.plan_id, priceId: price.id, status, interval: price.interval,
      startedAt: s.original_purchase_date ?? s.purchase_date, currentPeriodStart: s.purchase_date, currentPeriodEnd: (s.grace_period_expires_date && status === "past_due" ? s.grace_period_expires_date : s.expires_date) ?? new Date(0).toISOString(),
      cancelAtPeriodEnd: !!s.unsubscribe_detected_at, providerTimestamp: ts,
    });
    applied++;
  }
  return applied;
}
