import { requireAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { adminMetrics } from "@/lib/metrics";

export const GET = handle(async (req: Request) => {
  await requireAdmin(req);
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30)));
  return json(await adminMetrics(days));
});
