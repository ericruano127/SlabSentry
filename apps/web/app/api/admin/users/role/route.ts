import { z } from "zod";
import { one, tx } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { requirePermission, ROLES } from "@/lib/rbac";

/** Owner-only: assign a staff role by email. Audited. Owners cannot demote themselves (prevents lockout). */
export const PUT = handle(async (req: Request) => {
  const actor = await requirePermission(req, "roles:write");
  const { email, role, reason } = z.object({ email: z.string().email(), role: z.enum(ROLES), reason: z.string().min(3) }).parse(await req.json());
  const target = await one(`select id, role from app_users where lower(email)=lower($1) and deleted_at is null`, [email]);
  if (!target) throw new HttpError(404, "not_found", "No user with that email.");
  if (target.id === actor.id && role !== "owner") throw new HttpError(409, "self_demotion", "You can't remove your own owner role.");
  await tx(async (c) => {
    await c.query(`update app_users set role=$2, is_admin=$3 where id=$1`, [target.id, role, role === "admin" || role === "owner"]);
    await c.query(`insert into admin_audit_log (admin_id,action,before,after) values ($1,'role.update',$2,$3)`, [actor.id, JSON.stringify({ userId: target.id, role: target.role }), JSON.stringify({ userId: target.id, role, reason })]);
  });
  return json({ ok: true, role });
});
