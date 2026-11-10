import { z } from "zod";
import { handle, json } from "@/lib/http";
import { createDraft, listReleases, loadLibrary } from "@/lib/library";
import { requirePermission } from "@/lib/rbac";

export const GET = handle(async (req: Request) => {
  await requirePermission(req, "library:read");
  const lib = await loadLibrary();
  return json({ releases: await listReleases(), published: { version: lib.meta.version, sha256: lib.meta.sha256, content: lib.data } });
});

/** Create a draft copied from the published release (or `basedOn`). */
export const POST = handle(async (req: Request) => {
  const u = await requirePermission(req, "library:write");
  const { version, basedOn } = z.object({ version: z.string().regex(/^[0-9A-Za-z.\-]{3,40}$/), basedOn: z.number().int().optional() }).parse(await req.json());
  return json(await createDraft(u.id, version, basedOn), 201);
});
