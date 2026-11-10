import { one } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { listTemplates, templateHistory } from "@/lib/templates";

type Ctx = { params: Promise<{ id: string }> };

/** One template with its audit trail. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requirePermission(req, "library:read");
  const { id } = await ctx.params;
  const exists = await one(`select generation_id from verified_templates where id=$1`, [id]).catch(() => null);
  if (!exists) throw new HttpError(404, "not_found", "Template not found.");
  const t = (await listTemplates({ generationId: exists.generation_id })).find((x) => x.id === id);
  return json({ template: t, history: await templateHistory(id) });
});
