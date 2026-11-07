import { handle, json } from "@/lib/http";
import { loadPlans } from "@/lib/plans";

// Public: plan names, prices, allowances and features (no store ids beyond product ids needed by apps).
export const GET = handle(async () => {
  const plans = (await loadPlans()).filter((p) => p.active);
  return json({ plans: plans.map((p) => ({ ...p, prices: p.prices.filter((x) => x.active).map(({ stripePriceId, ...x }) => ({ ...x, webPurchasable: !!stripePriceId })) })) });
});
