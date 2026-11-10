/**
 * Fair market value from comparable sales (same item, same grader, same grade). Provider-agnostic:
 * comps can come from the user, a licensed price-data API, or (later) marketplace sold data.
 * FMV always ASSUMES THE ITEM IS GENUINE and is never an input to authenticity findings.
 */
export interface Comp {
  priceCents: number;
  currency: string;
  soldAt: string | null; // ISO date; null for undated guide prices
  source: string; // "user" | provider id
  title?: string;
  url?: string;
  gradeLabel?: string; // e.g. "PSA 10"
}

export interface MarketValue {
  status: "estimated" | "guide_only" | "insufficient_data" | "not_configured";
  estimateCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  currency: string;
  method: "median_recent_sales" | "price_guide" | "none";
  compsUsed: number;
  compsExcluded: number;
  windowDays: number;
  confidence: "high" | "medium" | "low" | "none";
  sources: string[];
  gradeLabel: string | null;
  asOf: string;
  note: string;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

export function computeMarketValue(comps: Comp[], opts: { gradeLabel?: string | null; guide?: { priceCents: number; currency: string; source: string } | null; now?: string; windowDays?: number } = {}): MarketValue {
  const now = new Date(opts.now ?? Date.now());
  const windowDays = opts.windowDays ?? 90;
  const base = { currency: "USD", gradeLabel: opts.gradeLabel ?? null, asOf: now.toISOString(), windowDays };
  const currency = comps[0]?.currency ?? opts.guide?.currency ?? "USD";
  const recent = comps.filter((c) => c.currency === currency && c.priceCents > 0 && (!c.soldAt || now.getTime() - new Date(c.soldAt).getTime() <= windowDays * 864e5));
  if (recent.length) {
    // Robust outlier removal (MAD) so a single mis-matched or shill sale doesn't move the estimate.
    const prices = recent.map((c) => c.priceCents);
    const med = median(prices);
    const mad = median(prices.map((p) => Math.abs(p - med))) * 1.4826;
    const kept = mad > 0 ? recent.filter((c) => Math.abs(c.priceCents - med) <= 3 * mad) : recent;
    const kp = kept.map((c) => c.priceCents);
    const n = kept.length;
    return {
      ...base, currency, status: "estimated", method: "median_recent_sales",
      estimateCents: Math.round(median(kp)),
      lowCents: Math.round(n >= 4 ? quantile(kp, 0.25) : Math.min(...kp)),
      highCents: Math.round(n >= 4 ? quantile(kp, 0.75) : Math.max(...kp)),
      compsUsed: n, compsExcluded: recent.length - n,
      confidence: n >= 8 ? "high" : n >= 3 ? "medium" : "low",
      sources: [...new Set(kept.map((c) => c.source))],
      note: `Median of ${n} comparable sale${n === 1 ? "" : "s"} in the last ${windowDays} days${recent.length - n ? ` (${recent.length - n} outlier${recent.length - n === 1 ? "" : "s"} excluded)` : ""}. Assumes the item is genuine.`,
    };
  }
  if (opts.guide && opts.guide.priceCents > 0) {
    return { ...base, currency: opts.guide.currency, status: "guide_only", method: "price_guide", estimateCents: opts.guide.priceCents, lowCents: null, highCents: null, compsUsed: 0, compsExcluded: 0, confidence: "low", sources: [opts.guide.source],
      note: "Price-guide value (no individual recent sales available). Assumes the item is genuine." };
  }
  return { ...base, status: "insufficient_data", method: "none", estimateCents: null, lowCents: null, highCents: null, compsUsed: 0, compsExcluded: comps.length, confidence: "none", sources: [],
    note: comps.length ? `No comparable sales within the last ${windowDays} days.` : "No comparable sales yet. Add recent sales of the same item, grader and grade to estimate value." };
}
