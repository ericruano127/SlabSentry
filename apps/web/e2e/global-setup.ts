import pg from "pg";

/**
 * Prepares the e2e database (already migrated): gives the paid prices test Stripe price ids so the
 * plan cards offer web checkout. Checkout itself is stubbed in the tests; no Stripe account is used.
 */
export default async function globalSetup() {
  const base = process.env.BASE_URL ?? "http://localhost:3000";
  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`The app isn't answering at ${base}. Start it first (see docs/TESTING.md § Browser tests).`);
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/slabguard_e2e" });
  await c.connect();
  try { await c.query(`update subscription_prices set stripe_price_id = 'price_e2e_' || id where stripe_price_id is null`); }
  finally { await c.end(); }
}
