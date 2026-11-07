import { requireUser } from "@/lib/auth";
import { usageSummary } from "@/lib/credits";
import { handle, json } from "@/lib/http";
import { isNewUser } from "@/lib/users";

export const GET = handle(async (req: Request) => {
  const u = await requireUser(req);
  const usage = await usageSummary(u.id);
  return json({ user: { id: u.id, email: u.email, isAdmin: u.isAdmin }, usage, welcome: await isNewUser(u.id) });
});
