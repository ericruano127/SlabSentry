import { appMetrics } from "./appMetrics";
import { one } from "./db";
import { HttpError } from "./http";

/**
 * Fixed-window counters shared by every app instance. Redis (REDIS_URL) in production — one INCR per
 * request; Postgres fallback for local/dev. Used for per-user API limits and for global quotas on
 * third-party APIs (e.g. PSA's daily lookup allowance).
 */
type Backend = { incr(key: string, windowSec: number): Promise<number> };

let redisBackend: Backend | null = null;
async function backend(): Promise<Backend> {
  if (process.env.REDIS_URL) {
    if (!redisBackend) {
      const { default: Redis } = await import("ioredis");
      // Commands wait for the connection but time out fast, so a Redis outage falls back to Postgres quickly.
      const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 500, connectTimeout: 2000 });
      r.on("error", () => {}); // surfaced through incr failures → Postgres fallback below
      redisBackend = {
        async incr(key, windowSec) {
          const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
          const res = await r.multi().incr(k).expire(k, windowSec + 5).exec();
          return Number(res?.[0]?.[1] ?? 0);
        },
      };
    }
    return redisBackend;
  }
  return pg;
}

const pg: Backend = {
  async incr(key, windowSec) {
    const r = await one<{ count: number }>(
      `insert into rate_limits (key, window_start, count) values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
       on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`,
      [key, windowSec],
    );
    return r?.count ?? 0;
  },
};

async function incr(key: string, windowSec: number) {
  try {
    return await (await backend()).incr(key, windowSec);
  } catch {
    return pg.incr(key, windowSec); // Redis unavailable → degrade to Postgres rather than fail requests
  }
}

export const limiterStats = { rejected: 0 };

/** Per-caller limit: throws 429 when exceeded. */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const n = await incr(key, windowSec);
  if (n > limit) {
    limiterStats.rejected++;
    appMetrics.rateLimited.add(1);
    throw new HttpError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", { retryAfterSec: windowSec });
  }
}

/** Global quota for a shared resource (no throw). Returns whether this use fits, and the count. */
export async function consumeQuota(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; used: number; limit: number }> {
  const used = await incr(`quota:${key}`, windowSec);
  return { ok: used <= limit, used, limit };
}
