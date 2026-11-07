import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";
import { storage } from "@/lib/storage";

// Images are private: served only to their owner, never via public URLs.
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  const img = await one(`select storage_key, mime from submitted_images where id=$1 and user_id=$2`, [(await ctx.params).id, u.id]);
  if (!img) throw new HttpError(404, "not_found", "Image not found");
  return new Response(new Uint8Array(await storage.get(img.storage_key)), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=3600" } });
});
