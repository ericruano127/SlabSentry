import { handleRevenueCatWebhook } from "@/lib/billing/revenuecat";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const r = await handleRevenueCatWebhook(await req.json(), req.headers.get("authorization"));
  return json(r, r.status === "in_progress" ? 409 : 200);
});
