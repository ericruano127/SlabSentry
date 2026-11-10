import { z } from "zod";
import { handle, json } from "@/lib/http";
import { publishRelease } from "@/lib/library";
import { requirePermission } from "@/lib/rbac";

/** Publish a draft, or re-publish a retired release (rollback). Audited; previous release retired. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requirePermission(req, "library:write");
  const { reason } = z.object({ reason: z.string().min(5) }).parse(await req.json());
  return json(await publishRelease(u.id, Number((await ctx.params).id), reason));
});
