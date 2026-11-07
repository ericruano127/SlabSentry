import { randomUUID } from "node:crypto";
import { pool, q } from "../lib/db";
import { migrate } from "../scripts/migrate";
import { ensureUser } from "../lib/users";

export async function resetDb() {
  await pool.query(`drop schema public cascade; create schema public;`);
  await migrate();
  await q(`update subscription_prices set stripe_price_id = 'price_' || id`);
}

export async function newUser() {
  const id = randomUUID();
  await ensureUser(id, `${id.slice(0, 6)}@example.com`);
  return id;
}

export async function newSession(userId: string, mode = "in_hand") {
  return (await q(`insert into verification_sessions (user_id,mode) values ($1,$2) returning id`, [userId, mode]))[0].id as string;
}

/** Minimal Stripe subscription object as delivered in webhooks (API 2025+ shape: period on items). */
export function stripeSub(o: { id?: string; userId: string; price: string; status?: string; start: Date; periodEnd: Date; cancelAtPeriodEnd?: boolean }) {
  const s = Math.floor(o.start.getTime() / 1000);
  return {
    id: o.id ?? "sub_" + o.userId.slice(0, 8), object: "subscription", customer: "cus_" + o.userId.slice(0, 8), status: o.status ?? "active",
    metadata: { user_id: o.userId }, start_date: s, billing_cycle_anchor: s, cancel_at_period_end: !!o.cancelAtPeriodEnd, cancel_at: null, ended_at: null,
    items: { data: [{ price: { id: o.price }, current_period_start: s, current_period_end: Math.floor(o.periodEnd.getTime() / 1000) }] },
  } as any;
}

export function stripeEvent(type: string, object: any, created: Date, id = "evt_" + randomUUID()) {
  return { id, type, created: Math.floor(created.getTime() / 1000), data: { object } } as any;
}
