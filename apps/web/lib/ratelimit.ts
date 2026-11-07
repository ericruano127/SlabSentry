import { one } from "./db";
import { HttpError } from "./http";

/** Fixed-window counter in Postgres (works across instances). */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const r = await one<{ count: number }>(
    `insert into rate_limits (key, window_start, count) values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`,
    [key, windowSec],
  );
  if (r && r.count > limit) throw new HttpError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", { retryAfterSec: windowSec });
}
