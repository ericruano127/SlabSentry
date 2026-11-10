import fmvConfig from "../../../config/fmv.json";
import { computeMarketValue, type Comp, type MarketValue, type OfficialCertRecord } from "@slabguard/core";
import { one, q } from "./db";

/**
 * Fair market value. Sources: user-entered comparable sales (always available) and licensed
 * price-data providers that are explicitly configured AND whose field mapping a staff member has
 * verified against a live response. FMV assumes the item is genuine and never feeds authenticity checks.
 */
type ProviderCfg = (typeof fmvConfig.providers)["pricecharting"] & { gradeFields: Record<string, string> };
const providers = fmvConfig.providers as Record<string, ProviderCfg>;

export function providerStatus() {
  return Object.entries(providers).map(([id, p]) => ({
    id, enabled: p.enabled, tokenConfigured: !!process.env[p.tokenEnv], mappingVerified: p.mappingVerified,
    usable: p.enabled && !!process.env[p.tokenEnv] && p.mappingVerified && Object.keys(p.gradeFields).length > 0,
  }));
}

/** Item identity used to search price data: official record first, user title second. */
export function identityQuery(record: OfficialCertRecord | null, itemTitle: string | null) {
  if (record?.found) return [record.year, record.brand, record.subject, record.cardNumber && `#${record.cardNumber}`, record.variety].filter(Boolean).join(" ");
  return itemTitle?.trim() || null;
}

export function gradeLabelFor(grader: string | null, record: OfficialCertRecord | null, userGrade: string | null) {
  const g = userGrade ?? (record?.found ? record.grade : null);
  if (!grader || !g) return null;
  const num = String(g).match(/\d+(\.\d)?/)?.[0];
  return num ? `${grader} ${num}` : null;
}

async function cached<T>(provider: string, key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = await one(`select data from market_cache where provider=$1 and query_key=$2 and fetched_at > now() - make_interval(hours => $3)`, [provider, key, fmvConfig.cacheHours]);
  if (hit) return hit.data as T;
  const data = await fetcher();
  await q(`insert into market_cache (provider,query_key,data) values ($1,$2,$3) on conflict (provider,query_key) do update set data=excluded.data, fetched_at=now()`, [provider, key, JSON.stringify(data)]);
  return data;
}

/** PriceCharting / SportsCardsPro: search → product → configured grade field. Returns a guide price only. */
async function priceChartingGuide(query: string, gradeLabel: string): Promise<{ priceCents: number; currency: string; source: string; productName: string } | null> {
  const p = providers.pricecharting;
  const token = process.env[p.tokenEnv];
  const field = p.gradeFields[gradeLabel];
  if (!p.enabled || !token || !p.mappingVerified || !field) return null;
  return cached("pricecharting", `${query}|${gradeLabel}`, async () => {
    const u = new URL(p.searchPath, p.baseUrl);
    u.searchParams.set("t", token);
    u.searchParams.set("q", query);
    const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`price provider ${r.status}`);
    const body = await r.json();
    const first = (body.products ?? [])[0];
    if (!first) return null;
    const pu = new URL(p.productPath, p.baseUrl);
    pu.searchParams.set("t", token);
    pu.searchParams.set("id", String(first[p.idField]));
    const pr = await fetch(pu, { signal: AbortSignal.timeout(10_000) });
    if (!pr.ok) throw new Error(`price provider ${pr.status}`);
    const prod = await pr.json();
    const raw = Number(prod[field]);
    if (!raw) return null;
    return { priceCents: Math.round(p.priceUnit === "dollars" ? raw * 100 : raw), currency: "USD", source: "pricecharting", productName: `${prod[p.nameField] ?? ""} (${prod[p.setField] ?? ""})` };
  });
}

/** Raw sample response for staff to confirm field names/units before enabling a provider. */
export async function sampleProviderResponse(query: string) {
  const p = providers.pricecharting;
  const token = process.env[p.tokenEnv];
  if (!token) return { error: `${p.tokenEnv} is not set` };
  const u = new URL(p.searchPath, p.baseUrl);
  u.searchParams.set("t", token);
  u.searchParams.set("q", query);
  const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
  const search = await r.json().catch(() => null);
  const id = search?.products?.[0]?.[p.idField];
  if (!id) return { search };
  const pu = new URL(p.productPath, p.baseUrl);
  pu.searchParams.set("t", token);
  pu.searchParams.set("id", String(id));
  return { search, product: await (await fetch(pu, { signal: AbortSignal.timeout(10_000) })).json().catch(() => null), currentMapping: p };
}

export async function marketValueFor(session: any, record: OfficialCertRecord | null): Promise<MarketValue> {
  const gradeLabel = gradeLabelFor(session.grader, record, session.grade_label);
  const rows = await q(`select * from market_comps where session_id=$1 order by sold_at desc nulls last`, [session.id]);
  const comps: Comp[] = rows
    .filter((r) => !gradeLabel || !r.grade_label || r.grade_label.toUpperCase() === gradeLabel.toUpperCase())
    .map((r) => ({ priceCents: r.price_cents, currency: r.currency, soldAt: r.sold_at, source: r.source, title: r.title ?? undefined, url: r.url ?? undefined, gradeLabel: r.grade_label ?? undefined }));
  let guide = null;
  const query = identityQuery(record, session.item_title);
  if (query && gradeLabel) guide = await priceChartingGuide(query, gradeLabel).catch(() => null);
  const mv = computeMarketValue(comps, { gradeLabel, guide, windowDays: fmvConfig.windowDays });
  if (mv.status === "insufficient_data" && !providerStatus().some((p) => p.usable))
    return { ...mv, note: `${mv.note} Automatic price data isn't connected yet.` };
  return mv;
}
