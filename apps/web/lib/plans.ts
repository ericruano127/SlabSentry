import { validatePlansConfig, type Plan } from "@slabguard/core";
import { q, type Q } from "./db";

let cache: { at: number; plans: Plan[] } | null = null;
const TTL = 30_000;

export function invalidatePlans() {
  cache = null;
}

export async function loadPlans(c?: Q): Promise<Plan[]> {
  if (!c && cache && Date.now() - cache.at < TTL) return cache.plans;
  const plans = await q(`select * from subscription_plans order by rank`, [], c);
  const prices = await q(`select * from subscription_prices order by amount_cents`, [], c);
  const out: Plan[] = plans.map((p) => ({
    id: p.id, name: p.name, tagline: p.tagline, rank: p.rank, monthlyAllowance: p.monthly_allowance, lifetimeAllowance: p.lifetime_allowance,
    features: p.features, marketingBullets: p.marketing_bullets, active: p.active,
    prices: prices.filter((x) => x.plan_id === p.id).map((x) => ({ id: x.id, interval: x.interval, amountCents: x.amount_cents, currency: x.currency, stripePriceId: x.stripe_price_id, appleProductId: x.apple_product_id, googleProductId: x.google_product_id, active: x.active })),
  }));
  if (!c) cache = { at: Date.now(), plans: out };
  return out;
}

/** Upsert plans/prices. Stripe price ids may come from env STRIPE_PRICE_<PRICE_ID>. */
export async function upsertPlans(c: Q, plans: Plan[]) {
  for (const p of plans) {
    await c.query(
      `insert into subscription_plans (id,name,tagline,rank,monthly_allowance,lifetime_allowance,features,marketing_bullets,active,updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       on conflict (id) do update set name=excluded.name, tagline=excluded.tagline, rank=excluded.rank, monthly_allowance=excluded.monthly_allowance,
         lifetime_allowance=excluded.lifetime_allowance, features=excluded.features, marketing_bullets=excluded.marketing_bullets, active=excluded.active, updated_at=now()`,
      [p.id, p.name, p.tagline, p.rank, p.monthlyAllowance, p.lifetimeAllowance, JSON.stringify(p.features), JSON.stringify(p.marketingBullets), p.active],
    );
    for (const x of p.prices) {
      const stripe = x.stripePriceId ?? process.env[`STRIPE_PRICE_${x.id.toUpperCase()}`] ?? null;
      await c.query(
        `insert into subscription_prices (id,plan_id,interval,amount_cents,currency,stripe_price_id,apple_product_id,google_product_id,active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set plan_id=excluded.plan_id, interval=excluded.interval, amount_cents=excluded.amount_cents, currency=excluded.currency,
           stripe_price_id=coalesce(excluded.stripe_price_id, subscription_prices.stripe_price_id), apple_product_id=excluded.apple_product_id,
           google_product_id=excluded.google_product_id, active=excluded.active`,
        [x.id, p.id, x.interval, x.amountCents, x.currency, stripe, x.appleProductId ?? null, x.googleProductId ?? null, x.active],
      );
    }
  }
  invalidatePlans();
}
