/** Database round-trips per request for the hottest endpoints (performance regression guard). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { usageSummary } from "../lib/credits";
import { GET as meGET } from "../app/api/me/route";
import { GET as sessionsGET, POST as sessionsPOST } from "../app/api/sessions/route";
import { GET as plansGET } from "../app/api/plans/route";
import { GET as releasesGET } from "../app/api/releases/route";
import { GET as libraryGET } from "../app/api/library/route";
import { newUser, req, resetDb } from "./helpers";

beforeAll(resetDb);
afterAll(() => pool.end());

async function count(fn: () => Promise<Response>) {
  const r = await fn();
  expect(r.status).toBeLessThan(300);
  return Number(r.headers.get("x-db-queries"));
}

describe("query budget per request (warm caches)", () => {
  it("measures the browse endpoints", async () => {
    const u = await newUser();
    const routes: [string, () => Promise<Response>][] = [
      ["GET /api/me", () => meGET(req("/api/me", u))],
      ["GET /api/sessions", () => sessionsGET(req("/api/sessions", u))],
      ["GET /api/plans", () => (plansGET as any)(req("/api/plans", u))],
      ["GET /api/releases", () => (releasesGET as any)(req("/api/releases", u))],
      ["GET /api/library", () => (libraryGET as any)(req("/api/library", u))],
      ["POST /api/sessions", () => sessionsPOST(req("/api/sessions", u, { method: "POST", json: { mode: "in_hand" } }))],
    ];
    const out: Record<string, number> = {};
    for (const [name, fn] of routes) { await fn(); out[name] = await count(fn); } // second call = warm caches
    console.log("QUERY_BUDGET", JSON.stringify(out));
    // Was 10 / 4 / 1 / 4 before the performance pass.
    expect(out).toEqual({ "GET /api/me": 3, "GET /api/sessions": 3, "GET /api/plans": 0, "GET /api/releases": 0, "GET /api/library": 0, "POST /api/sessions": 3 });
  });

  it("subscribers: the period allowance row is created once, then only read (no write per request)", async () => {
    const u = await newUser();
    const start = new Date(Date.now() - 5 * 864e5), end = new Date(Date.now() + 25 * 864e5);
    await q(`insert into user_subscriptions (user_id,plan_id,provider,provider_subscription_id,status,billing_interval,started_at,current_period_start,current_period_end)
             values ($1,'pro','manual',$4,'active','month',$2,$2,$3)`, [u, start.toISOString(), end.toISOString(), `m_${u}`]);
    const first = await usageSummary(u);
    expect(first.planId).toBe("pro");
    expect(first.periodAllowance).toBeGreaterThan(0);
    const row = (await q(`select id, xmin::text from verification_allowances where user_id=$1 and kind='subscription_period'`, [u]))[0];
    const second = await usageSummary(u);
    expect(second).toEqual(first);
    const after = (await q(`select id, xmin::text from verification_allowances where user_id=$1 and kind='subscription_period'`, [u]))[0];
    expect(after.xmin).toBe(row.xmin); // row not rewritten
    expect(await count(() => meGET(req("/api/me", u)))).toBe(3);
  });
});
