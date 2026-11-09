import defaultRates from "../../../config/costs.json";
import { q } from "./db";

// Rates are bundled at build time; override individual items with COST_RATE_<ITEM> env vars.
function costRates(): Record<string, number> {
  return defaultRates as unknown as Record<string, number>;
}

/** Record an estimated cost line for unit-economics reporting. */
export async function recordCost(sessionId: string, userId: string, item: string, units: number) {
  const rate = Number(process.env[`COST_RATE_${item.toUpperCase()}`] ?? costRates()[item] ?? 0);
  await q(`insert into processing_costs (session_id,user_id,item,units,cost_usd) values ($1,$2,$3,$4,$5)`, [sessionId, userId, item, units, units * rate]);
}

/** Record a cost line whose USD amount is already known (e.g. from token usage). */
export async function recordCostUsd(sessionId: string, userId: string, item: string, costUsd: number, units = 1) {
  await q(`insert into processing_costs (session_id,user_id,item,units,cost_usd) values ($1,$2,$3,$4,$5)`, [sessionId, userId, item, units, costUsd]);
}
