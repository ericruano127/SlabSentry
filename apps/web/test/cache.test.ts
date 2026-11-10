/** Single-flight cache: one reload per expiry under concurrency, bounded staleness, safe invalidation. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedValue } from "../lib/cache";

afterEach(() => vi.useRealTimers());
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const p = new Promise<T>((a, b) => ((resolve = a), (reject = b))); return { p, resolve, reject }; };

describe("cachedValue", () => {
  it("500 concurrent misses trigger exactly one load (no stampede)", async () => {
    let loads = 0;
    const c = cachedValue(1000, async () => { loads++; await new Promise((r) => setTimeout(r, 10)); return loads; });
    const out = await Promise.all(Array.from({ length: 500 }, () => c.get()));
    expect(loads).toBe(1);
    expect(new Set(out)).toEqual(new Set([1]));
  });

  it("stale-while-revalidate: just after expiry the old value is served while one refresh runs", async () => {
    vi.useFakeTimers();
    let n = 0;
    const d = deferred<number>();
    const c = cachedValue(1000, async () => (++n === 1 ? 1 : d.p), { staleWhileRevalidate: true });
    expect(await c.get()).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(await Promise.all([c.get(), c.get(), c.get()])).toEqual([1, 1, 1]); // no one waits
    expect(n).toBe(2); // one background refresh
    d.resolve(2);
    await d.p; await Promise.resolve();
    expect(await c.get()).toBe(2);
    vi.advanceTimersByTime(10_000); // older than 4 × ttl: never served stale
    const fresh = deferred<number>();
    const c2 = cachedValue(1000, () => fresh.p, { staleWhileRevalidate: true });
    const pending = c2.get();
    fresh.resolve(7);
    expect(await pending).toBe(7);
  });

  it("without stale serving, a failed reload is surfaced and not cached", async () => {
    vi.useFakeTimers();
    let fail = false;
    const c = cachedValue(1000, async () => { if (fail) throw new Error("integrity"); return "ok"; });
    expect(await c.get()).toBe("ok");
    vi.advanceTimersByTime(1500);
    fail = true;
    await expect(c.get()).rejects.toThrow("integrity");
    fail = false;
    expect(await c.get()).toBe("ok");
  });

  it("invalidate() ignores a reload already in flight", async () => {
    const d = deferred<string>();
    let first = true;
    const c = cachedValue(60_000, async () => (first ? ((first = false), d.p) : "new"));
    const old = c.get();
    c.invalidate();
    d.resolve("old");
    expect(await old).toBe("old"); // the caller that started it still gets its answer…
    expect(await c.get()).toBe("new"); // …but it isn't cached
  });
});
