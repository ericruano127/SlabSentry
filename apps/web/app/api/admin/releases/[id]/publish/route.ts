import { z } from "zod";
import { handle, json } from "@/lib/http";
import { publishRelease } from "@/lib/releases";
import { requirePermission } from "@/lib/rbac";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requirePermission(req, "releases:write");
  const { overrideReason } = z.object({ overrideReason: z.string().min(10).optional() }).parse(await req.json().catch(() => ({})));
  return json(await publishRelease({ id: u.id, role: u.role }, Number((await ctx.params).id), overrideReason));
});
