import { z } from "zod";
import { q } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { createRelease, currentComponents } from "@/lib/releases";
import { requirePermission } from "@/lib/rbac";

export const GET = handle(async (req: Request) => {
  await requirePermission(req, "quality:read");
  return json({ components: await currentComponents(), releases: await q(`select id, version, status, components, public_notes, internal_notes, accuracy, gate, gate_override_reason, created_at, published_at from releases order by id desc limit 50`) });
});

/** Create a draft release: snapshot components, lint public notes, evaluate accuracy, compute the gate. */
export const POST = handle(async (req: Request) => {
  const u = await requirePermission(req, "releases:write");
  const b = z.object({ version: z.string().regex(/^[0-9A-Za-z.\-+]{3,40}$/), publicNotes: z.string().min(10).max(4000), internalNotes: z.string().min(20).max(20000) }).parse(await req.json());
  return json(await createRelease(u.id, b), 201);
});
