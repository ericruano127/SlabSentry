import { z } from "zod";
import { handle, json } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { retireTemplate } from "@/lib/templates";

/** Stop using an approved template (reason required, audited). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requirePermission(req, "library:review");
  const { reason } = z.object({ reason: z.string().max(2000) }).parse(await req.json());
  return json(await retireTemplate(u.id, (await ctx.params).id, reason));
});
