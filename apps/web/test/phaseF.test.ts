/** Phase F: shared rate limits (Redis + Postgres fallback), global PSA quota with graceful
 * degradation, progress reporting, readiness and metrics endpoints. */
import { existsSync, readFileSync } from "node:fs";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { env } from "../lib/env";
import { consumeQuota, rateLimit } from "../lib/ratelimit";
import { lookupCert } from "../lib/graders/lookup";
import { loadLibrary } from "../lib/library";
import { reserveCredit } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { addImage } from "../lib/sessions";
import { sessionView } from "../lib/views";
import { GET as readyGET } from "../app/api/ready/route";
import { GET as metricsGET } from "../app/api/metrics/route";
import { newSession, newUser, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const vision = (await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false)) && existsSync(`${FIX}/front_different_card.jpg`);
const redisUp = await new Redis("redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 0 }).connect().then(() => true, () => false);

beforeAll(resetDb);
afterAll(async () => { delete process.env.REDIS_URL; await pool.end(); });

describe("shared rate limits", () => {
  it("Postgres backend enforces a per-user window across calls", async () => {
    delete process.env.REDIS_URL;
    for (let i = 0; i < 3; i++) await rateLimit("t:pg", 3, 60);
    await expect(rateLimit("t:pg", 3, 60)).rejects.toMatchObject({ status: 429 });
  });

  it.skipIf(!redisUp)("Redis backend is used when configured (one counter shared by every instance)", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    const key = `t:redis:${Date.now()}`;
    expect((await consumeQuota(key, 2, 60)).ok).toBe(true);
    expect((await consumeQuota(key, 2, 60)).ok).toBe(true);
    expect((await consumeQuota(key, 2, 60)).ok).toBe(false);
    const r = new Redis("redis://127.0.0.1:6379");
    expect((await r.keys(`rl:quota:${key}:*`)).length).toBe(1);
    r.disconnect();
    expect((await q(`select count(*)::int n from rate_limits where key like $1`, [`quota:${key}%`]))[0].n).toBe(0); // not in Postgres
  });
});

describe("PSA quota and graceful degradation", () => {
  it("stops calling PSA when the global daily allowance is used up and says so", async () => {
    delete process.env.REDIS_URL;
    (env as any).psaToken = "test-token";
    for (let i = 0; i < 60; i++) await consumeQuota("psa:daily", 1_000_000, 86_400); // exhaust (limit is 50 lookups = 100 calls)
    const r = await lookupCert("PSA", "12345678", await loadLibrary());
    expect(r.providerError).toBe("quota_exhausted");
    expect(r.record.found).toBeNull();
    expect(r.record.provenance.note).toMatch(/daily lookup limit/);
  });

  it.skipIf(!vision)("delivers a partial report that names what was unavailable, shows progress, and doesn't charge when nothing could be compared", async () => {
    const u = await newUser();
    const s = await newSession(u);
    await q(`update verification_sessions set grader='PSA', cert_number='12345678', cert_confirmed=true where id=$1`, [s]);
    await addImage(u, s, "front", readFileSync(`${FIX}/front_genuine.jpg`));
    await addImage(u, s, "back", readFileSync(`${FIX}/front_different_card.jpg`));
    await reserveCredit(u, s);
    await q(`update verification_sessions set status='queued' where id=$1`, [s]); // as the analyze endpoint does
    await enqueueAnalysis(s, 0);
    const queued = await sessionView((await q(`select * from verification_sessions where id=$1`, [s]))[0]);
    expect(queued.progress).toMatchObject({ percent: 5, stage: "Waiting in queue", queueAhead: 0 });
    await drainJobs();
    const row = (await q(`select progress, stage, credit_state from verification_sessions where id=$1`, [s]))[0];
    expect([row.progress, row.stage]).toEqual([100, null]);
    const rep = (await q(`select report from verification_reports where session_id=$1`, [s]))[0].report;
    expect(rep.degraded[0]).toMatch(/daily lookup limit/);
    expect(rep.quickSummary.cantSee[0]).toMatch(/Official record/);
    expect(row.credit_state).toBe("released"); // provider outage + no comparison → not charged
    (env as any).psaToken = "";
  });
});

describe("vision outage", () => {
  it.skipIf(!existsSync(`${FIX}/front_genuine.jpg`))("retries with backoff, then fails with a clear message and releases the credit", async () => {
    const saved = env.visionUrl;
    (env as any).visionUrl = "http://127.0.0.1:9"; // nothing listens here
    try {
      const u = await newUser();
      const s = await newSession(u);
      await q(`update verification_sessions set grader='PSA', cert_number='12345678', cert_confirmed=true where id=$1`, [s]);
      await addImage(u, s, "front", readFileSync(`${FIX}/front_genuine.jpg`)); // stored without quality while vision is down
      await addImage(u, s, "back", readFileSync(`${FIX}/front_different_card.jpg`));
      await reserveCredit(u, s);
      await enqueueAnalysis(s, 0);
      for (let attempt = 1; attempt <= 3; attempt++) {
        await drainJobs();
        const job = (await q(`select status, attempts, run_after > now() later from jobs where payload->>'sessionId'=$1`, [s]))[0];
        if (attempt < 3) {
          expect([job.status, job.attempts, job.later]).toEqual(["queued", attempt, true]); // backed off, not failed
          await q(`update jobs set run_after=now() where payload->>'sessionId'=$1`, [s]);
        } else expect(job.status).toBe("failed");
      }
      const row = (await q(`select status, error, credit_state from verification_sessions where id=$1`, [s]))[0];
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/temporarily unavailable.*No verification credit was used/);
      expect(row.credit_state).toBe("released");
    } finally {
      (env as any).visionUrl = saved;
    }
  });
});

describe("operations endpoints", () => {
  it("readiness checks database and library; metrics require a token", async () => {
    const r = await readyGET();
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.checks.database.ok && body.checks.library.ok).toBe(true);
    expect((await metricsGET(new Request("http://x/api/metrics"))).status).toBe(403);
    process.env.METRICS_TOKEN = "metrics-test-token";
    const m = await metricsGET(new Request("http://x/api/metrics", { headers: { authorization: "Bearer metrics-test-token" } }));
    const text = await m.text();
    expect(m.status).toBe(200);
    expect(text).toMatch(/slabguard_queue_oldest_seconds \d/);
    expect(text).toMatch(/slabguard_analysis_seconds\{quantile="0.95"\}/);
  });
});
