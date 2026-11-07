import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createCheckout } from "@/lib/billing/stripe";
import { handle, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const POST = handle(async (req: Request) => {
  const u = await requireUser(req);
  await rateLimit(`checkout:${u.id}`, 10, 600);
  const { priceId } = z.object({ priceId: z.string() }).parse(await req.json());
  return json({ url: await createCheckout(u.id, u.email, priceId) });
});
