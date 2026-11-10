/**
 * Per-process cache for small, hot, rarely-changing data (legal documents, plans, library, patch notes).
 *
 * - Single-flight: when the value expires under load, ONE request reloads it and every concurrent
 *   request awaits that same load. Without this, hundreds of requests miss at the same instant and
 *   all query the database together (a cache stampede that shows up as tail-latency spikes).
 * - Optional stale-while-revalidate: just after expiry, the previous value is served while a single
 *   background refresh runs, so no request waits. Staleness is bounded by ttl + one reload; values older
 *   than 4 × ttl are never served. Leave it off where a failed reload must stop service (the library).
 * - invalidate() drops the value and ignores any reload already in flight.
 */
export function cachedValue<T>(ttlMs: number, load: () => Promise<T>, opts: { staleWhileRevalidate?: boolean } = {}) {
  let value: { at: number; v: T } | null = null;
  let inflight: Promise<T> | null = null;
  let generation = 0;
  const refresh = () => {
    if (!inflight) {
      const g = generation;
      const p = load().then((v) => { if (g === generation) value = { at: Date.now(), v }; return v; });
      inflight = p;
      p.finally(() => { if (inflight === p) inflight = null; }).catch(() => {});
    }
    return inflight;
  };
  return {
    async get(): Promise<T> {
      const age = value ? Date.now() - value.at : Infinity;
      if (value && age < ttlMs) return value.v;
      if (value && opts.staleWhileRevalidate && age < ttlMs * 4) { refresh().catch(() => {}); return value.v; }
      return refresh();
    },
    invalidate() { generation++; value = null; inflight = null; },
  };
}
