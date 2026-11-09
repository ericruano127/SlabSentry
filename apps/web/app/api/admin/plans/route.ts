import { PlanSchema } from "@slabguard/core";
import { z } from "zod";
import { requirePermission } from "@/lib/rbac";
import { tx } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { loadPlans, upsertPlans } from "@/lib/plans";
import { recomputeEntitlements } from "@/lib/billing/subscriptions";

export const GET = handle(async (req: Request) => {
  await requirePermission(req, "plans:read");
  return json({ plans: await loadPlans() });
});

/** Edit plans/prices/allowances without code changes. Audited. Existing users' lifetime free grants are not changed. */
export const PUT = handle(async (req: Request) => {
  const admin = await requirePermission(req, "plans:write");
  const { plans, reason } = z.object({ plans: z.array(PlanSchema).min(1), reason: z.string().min(3) }).parse(await req.json());
  if (!plans.some((p) => p.id === "free")) throw new HttpError(400, "free_required", "A free plan is required.");
  const before = await loadPlans();
  await tx(async (c) => {
    await upsertPlans(c, plans);
    await c.query(`insert into admin_audit_log (admin_id,action,before,after) values ($1,'plans.update',$2,$3)`, [admin.id, JSON.stringify(before), JSON.stringify({ plans, reason })]);
    // Re-materialize entitlements for subscribers so allowance changes apply to current windows.
    const users = (await c.query(`select distinct user_id from user_subscriptions where current_period_end > now()`)).rows;
    for (const u of users) await recomputeEntitlements(u.user_id, c);
  });
  return json({ plans: await loadPlans() });
});
