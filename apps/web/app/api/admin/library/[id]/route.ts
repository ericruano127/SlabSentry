import { z } from "zod";
import { handle, json } from "@/lib/http";
import { getRelease, sha256, updateDraft } from "@/lib/library";
import { requirePermission } from "@/lib/rbac";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requirePermission(req, "library:read");
  const r = await getRelease(Number((await ctx.params).id));
  return json({ ...r, computedSha256: sha256(r.content), integrityOk: !r.content_sha256 || r.content_sha256 === sha256(r.content) });
});

/** Replace a draft's content (validated against the library schema). */
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const u = await requirePermission(req, "library:write");
  const { content, notes } = z.object({ content: z.unknown(), notes: z.string().max(2000).optional() }).parse(await req.json());
  return json(await updateDraft(u.id, Number((await ctx.params).id), content, notes));
});
