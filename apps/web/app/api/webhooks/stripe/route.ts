import { handleStripeWebhook } from "@/lib/billing/stripe";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const r = await handleStripeWebhook(await req.text(), req.headers.get("stripe-signature"));
  // 409 asks Stripe to retry later if another delivery of this event is mid-processing.
  return json(r, r.status === "in_progress" ? 409 : 200);
});
