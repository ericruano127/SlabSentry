import { requireUser } from "@/lib/auth";
import { createPortal } from "@/lib/billing/stripe";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const u = await requireUser(req);
  return json({ url: await createPortal(u.id) });
});
