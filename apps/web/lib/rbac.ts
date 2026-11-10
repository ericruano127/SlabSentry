import { requireUser, type AuthUser } from "./auth";
import { HttpError } from "./http";

/** Least-privilege staff roles. Every staff permission also requires an MFA (aal2) session. */
export const ROLES = ["user", "support", "analyst", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "metrics:read": ["analyst", "admin", "owner"],
  "plans:read": ["analyst", "admin", "owner"],
  "plans:write": ["admin", "owner"],
  "users:read": ["support", "admin", "owner"],
  "roles:write": ["owner"],
  "audit:read": ["admin", "owner"],
  "library:read": ["analyst", "admin", "owner"],
  "library:write": ["admin", "owner"],
  "library:submit": ["analyst", "admin", "owner"], // submit verified templates for review
  "library:review": ["admin", "owner"], // approve/reject/retire templates (never one's own submission)
  "privacy:read": ["support", "admin", "owner"],
  "quality:read": ["analyst", "admin", "owner"],
  "quality:label": ["analyst", "admin", "owner"],
  "releases:write": ["admin", "owner"],
  "gate:override": ["owner"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const isStaff = (role: Role) => role !== "user";
export const can = (role: Role, p: Permission) => (PERMISSIONS[p] as readonly Role[]).includes(role);

export async function requirePermission(req: Request, p: Permission): Promise<AuthUser> {
  const u = await requireUser(req);
  if (!can(u.role, p)) throw new HttpError(403, "forbidden", "You don't have access to this.");
  if (u.aal !== "aal2") throw new HttpError(403, "mfa_required", "Staff tools require two-factor authentication. Enable it in Account → Security, then sign in again.");
  return u;
}
