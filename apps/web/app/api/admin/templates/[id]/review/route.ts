import { z } from "zod";
import { handle, json } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { reviewTemplate } from "@/lib/templates";

/** Approve or reject a pending template. The reviewer can't be the submitter (two-person rule). */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requirePermission(req, "library:review");
  const b = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(2000).default("") }).parse(await req.json());
  return json(await reviewTemplate({ id: u.id, role: u.role }, (await ctx.params).id, b.decision, b.note));
});
