import { requireUser } from "@/lib/auth";
import { handle, HttpError, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { addImage, getOwnedSession, ROLES, type Role } from "@/lib/sessions";

// Uploading photos (including retakes) never uses a credit.
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser(req);
  await rateLimit(`upload:${u.id}`, 120, 3600);
  const s = await getOwnedSession(u.id, (await ctx.params).id);
  if (s.status === "processing" || s.status === "queued") throw new HttpError(409, "busy", "Analysis in progress — add photos when it finishes.");
  const fd = await req.formData();
  const file = fd.get("file");
  const role = String(fd.get("role") ?? "");
  if (!(file instanceof Blob)) throw new HttpError(400, "missing_file", "No photo attached.");
  if (!ROLES.includes(role as Role)) throw new HttpError(400, "invalid_role", "Unknown photo type.");
  const row = await addImage(u.id, s.id, role as Role, Buffer.from(await file.arrayBuffer()), { attestation: fd.get("attestation")?.toString() });
  return json({ image: row }, 201);
});
