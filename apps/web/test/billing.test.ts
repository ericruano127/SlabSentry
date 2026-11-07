import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool, q } from "../lib/db";
import { consumeCredit, releaseCredit, reserveCredit, usageSummary } from "../lib/credits";
import { applyStripeEvent, createCheckout, stripe } from "../lib/billing/stripe";
import { applyRevenueCatEvent, reconcileRevenueCat } from "../lib/billing/revenuecat";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { HttpError } from "../lib/http";
import { newSession, newUser, resetDb, stripeEvent, stripeSub } from "./helpers";

beforeAll(resetDb);
afterAll(() => pool.end());

async function scan(userId: string, now?: Date) {
  const s = await newSession(userId);
  await reserveCredit(userId, s, now);
  await consumeCredit(userId, s);
  return s;
}
const err = async (p: Promise<unknown>) => p.then(() => null, (e) => e as HttpError);
const day = (iso: string) => new Date(iso);

describe("free tier", () => {
  it("allows three free scans and blocks the fourth with upgrade options", async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await scan(u);
    const e = await err(reserveCredit(u, await newSession(u)));
    expect(e?.status).toBe(402);
    expect(e?.extra).toMatchObject({ upgrade: true, planId: "free" });
    const sum = await usageSummary(u);
    expect([sum.freeUsed, sum.freeRemaining, sum.totalRemaining]).toEqual([3, 0, 0]);
  });

  it("counts multiple photos / retries / re-analysis of one slab as one verification", async () => {
    const u = await newUser();
    const s = await newSession(u);
    expect((await reserveCredit(u, s)).status).toBe("reserved");
    expect((await reserveCredit(u, s)).status).toBe("already_reserved");
    await consumeCredit(u, s);
    await consumeCredit(u, s); // duplicate consume is a no-op
    expect((await reserveCredit(u, s)).status).toBe("already_consumed");
    expect((await usageSummary(u)).freeUsed).toBe(1);
  });

  it("failed analysis does not consume a credit", async () => {
    const u = await newUser();
    const s = await newSession(u);
    await reserveCredit(u, s);
    expect((await usageSummary(u)).freeRemaining).toBe(2);
    await releaseCredit(u, s, "server_error");
    expect((await usageSummary(u)).freeRemaining).toBe(3);
    expect((await reserveCredit(u, s)).attempt).toBe(2); // retry may reserve again
    const ledger = await q(`select action, attempt from verification_usage_ledger where session_id=$1 order by id`, [s]);
    expect(ledger.map((l) => `${l.action}${l.attempt}`)).toEqual(["reserve1", "release1", "reserve2"]);
  });

  it("job failure releases the reserved credit", async () => {
    const u = await newUser();
    const s = await newSession(u); // no images -> pipeline error
    await reserveCredit(u, s);
    await enqueueAnalysis(s, 0);
    await drainJobs();
    const row = (await q(`select status, credit_state, error from verification_sessions where id=$1`, [s]))[0];
    expect(row.status).toBe("failed");
    expect(row.credit_state).toBe("released");
    expect(row.error).toMatch(/No verification credit was used/);
  });

  it("prevents over-spend under concurrent scans near the limit", async () => {
    const u = await newUser();
    await scan(u);
    await scan(u); // 1 left
    const sessions = await Promise.all(Array.from({ length: 6 }, () => newSession(u)));
    const results = await Promise.allSettled(sessions.map((s) => reserveCredit(u, s)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const sum = await usageSummary(u);
    expect(sum.freeUsed + sum.periodReserved).toBe(2);
    const a = (await q(`select used, reserved, granted from verification_allowances where user_id=$1 and kind='lifetime_free'`, [u]))[0];
    expect(a.used + a.reserved).toBe(3);
  });
});

describe("subscriptions", () => {
  it("activates a paid plan from Stripe checkout and is idempotent on duplicate webhooks", async () => {
    const u = await newUser();
    const start = new Date();
    const sub = stripeSub({ userId: u, price: "price_pro_month", start, periodEnd: new Date(start.getTime() + 30 * 864e5) });
    const evt = stripeEvent("customer.subscription.created", sub, start);
    expect((await applyStripeEvent(evt)).duplicate).toBe(false);
    expect((await applyStripeEvent(evt)).duplicate).toBe(true);
    const sum = await usageSummary(u);
    expect([sum.planId, sum.periodAllowance, sum.totalRemaining]).toEqual(["pro", 30, 33]); // 30 monthly + 3 unused free
    expect((await q(`select count(*)::int n from billing_events where provider_event_id=$1`, [evt.id]))[0].n).toBe(1);
  });

  it("checkout.session.completed fetches and applies the subscription", async () => {
    const u = await newUser();
    const start = new Date();
    const sub = stripeSub({ userId: u, price: "price_power_year", start, periodEnd: new Date(start.getTime() + 365 * 864e5) });
    sub.metadata = {};
    await applyStripeEvent(stripeEvent("checkout.session.completed", { mode: "subscription", subscription: sub.id, client_reference_id: u, customer: sub.customer }, start), async () => sub);
    const s = await usageSummary(u);
    expect([s.planId, s.billingInterval, s.periodAllowance]).toEqual(["power", "year", 100]);
  });

  it("ignores out-of-order (stale) subscription events", async () => {
    const u = await newUser();
    const t = day("2026-03-01T00:00:00Z");
    const end = day("2027-03-01T00:00:00Z");
    await applyStripeEvent(stripeEvent("customer.subscription.updated", stripeSub({ userId: u, price: "price_power_month", start: t, periodEnd: end }), day("2026-03-10T00:00:00Z")));
    await applyStripeEvent(stripeEvent("customer.subscription.updated", stripeSub({ userId: u, price: "price_pro_month", start: t, periodEnd: end }), day("2026-03-05T00:00:00Z")));
    expect((await q(`select plan_id from user_subscriptions where user_id=$1`, [u]))[0].plan_id).toBe("power");
  });

  it("resets monthly allowance; no rollover; annual plans reset monthly too", async () => {
    for (const price of ["price_pro_month", "price_pro_year"]) {
      const u = await newUser();
      const start = day("2026-01-15T00:00:00Z");
      const end = price.endsWith("year") ? day("2027-01-15T00:00:00Z") : day("2026-12-31T00:00:00Z");
      await applyStripeEvent(stripeEvent("customer.subscription.created", stripeSub({ userId: u, price, start, periodEnd: end }), start));
      const jan = day("2026-01-20T00:00:00Z");
      for (let i = 0; i < 5; i++) await scan(u, jan);
      expect((await usageSummary(u, undefined, jan)).periodRemaining).toBe(25);
      const feb = day("2026-02-16T00:00:00Z");
      const s = await usageSummary(u, undefined, feb);
      expect([s.periodUsed, s.periodRemaining, s.windowStart]).toEqual([0, 30, "2026-02-15T00:00:00.000Z"]);
    }
  });

  it("upgrades take effect immediately; downgrades clamp remaining credits", async () => {
    const u = await newUser();
    const start = new Date(Date.now() - 2 * 864e5);
    const end = new Date(start.getTime() + 30 * 864e5);
    const id = "sub_updown_" + u.slice(0, 6);
    await applyStripeEvent(stripeEvent("customer.subscription.created", stripeSub({ id, userId: u, price: "price_pro_month", start, periodEnd: end }), new Date(Date.now() - 1000)));
    for (let i = 0; i < 31; i++) await scan(u); // 30 period + 1 free
    await applyStripeEvent(stripeEvent("customer.subscription.updated", stripeSub({ id, userId: u, price: "price_power_month", start, periodEnd: end }), new Date()));
    let s = await usageSummary(u);
    expect([s.planId, s.periodUsed, s.periodRemaining]).toEqual(["power", 30, 70]);
    for (let i = 0; i < 10; i++) await scan(u);
    await applyStripeEvent(stripeEvent("customer.subscription.updated", stripeSub({ id, userId: u, price: "price_pro_month", start, periodEnd: end }), new Date(Date.now() + 1000)));
    s = await usageSummary(u);
    expect([s.planId, s.periodUsed, s.periodRemaining, s.freeRemaining]).toEqual(["pro", 40, 0, 2]);
  });

  it("canceled subscriptions keep access until period end, then revert to Free keeping history", async () => {
    const u = await newUser();
    const start = day("2026-04-01T00:00:00Z");
    const end = day("2026-05-01T00:00:00Z");
    const sub = stripeSub({ userId: u, price: "price_pro_month", start, periodEnd: end, cancelAtPeriodEnd: true });
    await applyStripeEvent(stripeEvent("customer.subscription.updated", sub, start));
    const mid = await usageSummary(u, undefined, day("2026-04-20T00:00:00Z"));
    expect([mid.planId, mid.willCancel, mid.renewsAt]).toEqual(["pro", true, null]);
    await scan(u, day("2026-04-20T00:00:00Z"));
    await applyStripeEvent(stripeEvent("customer.subscription.deleted", { ...sub, status: "canceled", ended_at: Math.floor(end.getTime() / 1000) }, end));
    const after = await usageSummary(u, undefined, day("2026-05-02T00:00:00Z"));
    expect([after.planId, after.freeRemaining]).toEqual(["free", 3]);
    expect((await q(`select count(*)::int n from verification_sessions where user_id=$1`, [u]))[0].n).toBe(1);
  });

  it("shares entitlements across devices/providers (App Store via RevenueCat)", async () => {
    const u = await newUser();
    const now = Date.now();
    const evt = { id: "rc_" + u, type: "INITIAL_PURCHASE", app_user_id: u, product_id: "slabguard.pro.monthly", store: "APP_STORE", environment: "PRODUCTION", purchased_at_ms: now, original_purchased_at_ms: now, expiration_at_ms: now + 30 * 864e5, event_timestamp_ms: now, transaction_id: "tx1", price_in_purchased_currency: 9.99, currency: "USD" };
    await applyRevenueCatEvent(evt);
    await applyRevenueCatEvent(evt); // duplicate
    const s = await usageSummary(u); // the web reads the same user record
    expect([s.planId, s.subscriptionProvider]).toEqual(["pro", "app_store"]);
    expect((await q(`select count(*)::int n from payments where user_id=$1`, [u]))[0].n).toBe(1);
    // A web checkout is refused to prevent double billing
    expect((await err(createCheckout(u, null, "power_month")))?.code).toBe("managed_elsewhere");
  });

  it("reconciles refunds from the store as loss of access (restore purchases path)", async () => {
    const u = await newUser();
    const iso = (d: number) => new Date(d).toISOString();
    const now = Date.now();
    const subscriber = { subscriptions: { "slabguard_power:monthly": { store: "PLAY_STORE", purchase_date: iso(now - 864e5), original_purchase_date: iso(now - 864e5), expires_date: iso(now + 29 * 864e5), refunded_at: null } } };
    expect(await reconcileRevenueCat(u, async () => subscriber)).toBe(1);
    expect((await usageSummary(u)).planId).toBe("power");
    (subscriber.subscriptions as any)["slabguard_power:monthly"].refunded_at = iso(now);
    await reconcileRevenueCat(u, async () => subscriber, now + 1000);
    expect((await usageSummary(u)).planId).toBe("free");
  });

  it("records disputes and refunds", async () => {
    const u = await newUser();
    await applyStripeEvent(stripeEvent("invoice.paid", { id: "in_1" + u.slice(0, 4), customer: "cus_x", amount_paid: 999, currency: "usd" }, new Date()));
    await applyStripeEvent(stripeEvent("charge.refunded", { id: "ch_1", invoice: "in_1" + u.slice(0, 4), amount: 999, amount_refunded: 999, currency: "usd" }, new Date()));
    expect((await q(`select status from payments where provider_payment_id=$1`, ["in_1" + u.slice(0, 4)]))[0].status).toBe("refunded");
  });

  it("degrades gracefully when the billing provider is down", async () => {
    const u = await newUser();
    vi.spyOn(stripe().customers, "create").mockRejectedValueOnce(new Error("ECONNRESET"));
    const e = await err(createCheckout(u, "a@b.c", "pro_month"));
    expect([e?.status, e?.code]).toEqual([503, "billing_unavailable"]);
    expect((await usageSummary(u)).freeRemaining).toBe(3);
  });

  it("retries a webhook whose processing previously failed", async () => {
    const u = await newUser();
    const start = new Date();
    const sub = stripeSub({ userId: u, price: "price_unknown", start, periodEnd: new Date(start.getTime() + 864e5 * 30) });
    const evt = stripeEvent("customer.subscription.created", sub, start);
    await expect(applyStripeEvent(evt)).rejects.toThrow();
    sub.items.data[0].price.id = "price_pro_month"; // e.g. config fixed, provider redelivers
    expect((await applyStripeEvent(evt)).status).toBe("processed");
    expect((await usageSummary(u)).planId).toBe("pro");
  });
});
