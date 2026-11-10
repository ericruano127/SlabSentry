import { requireUser } from "@/lib/auth";
import { consentStatus } from "@/lib/consent";
import { usageSummary } from "@/lib/credits";
import { can, isStaff } from "@/lib/rbac";
import { handle, json } from "@/lib/http";
import { isNewUser } from "@/lib/users";

export const GET = handle(async (req: Request) => {
  const u = await requireUser(req, { skipConsent: true });
  const usage = await usageSummary(u.id);
  return json({
    user: { id: u.id, email: u.email, isAdmin: u.isAdmin, role: u.role, isStaff: isStaff(u.role), mfa: u.aal === "aal2", canViewMetrics: can(u.role, "metrics:read") },
    usage, welcome: isNewUser(u.row), consent: await consentStatus(u.id, u.row as any),
  });
});
