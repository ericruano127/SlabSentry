import { toShareable } from "@slabguard/core";
import { one } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const r = await one(`select report from verification_reports where share_token=$1`, [(await ctx.params).token]);
  if (!r) throw new HttpError(404, "not_found", "This shared report is no longer available.");
  const rep = toShareable(r.report);
  // drop image references: shared reports never expose user photos
  rep.engine = { ...rep.engine, observations: rep.engine.observations.map((o) => ({ ...o, imageRefs: [] })) };
  return json({ report: rep });
});
