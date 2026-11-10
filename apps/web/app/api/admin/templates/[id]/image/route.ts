import { handle } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { templateImage } from "@/lib/templates";

/** Staff-only preview of a template, or (?which=source) the full photo it was cut from. Never cached publicly. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requirePermission(req, "library:read");
  const which = new URL(req.url).searchParams.get("which") === "source" ? "source" : "template";
  const data = await templateImage((await ctx.params).id, which);
  return new Response(new Uint8Array(data), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" } });
});
