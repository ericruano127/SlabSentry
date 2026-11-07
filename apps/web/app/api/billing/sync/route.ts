import { requireUser } from "@/lib/auth";
import { reconcileRevenueCat } from "@/lib/billing/revenuecat";
import { usageSummary } from "@/lib/credits";
import { handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

/** Called by the mobile app after purchase / "Restore Purchases". Validates server-side with RevenueCat. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser(req);
  await rateLimit(`sync:${u.id}`, 20, 600);
  const applied = await reconcileRevenueCat(u.id);
  return json({ applied, usage: await usageSummary(u.id) });
});
