import { handle, json } from "@/lib/http";
import { accuracyReport } from "@/lib/evaluation";
import { requirePermission } from "@/lib/rbac";

/** Accuracy on independently labeled sessions: as delivered ("recorded") or with current rules ("replay"). */
export const GET = handle(async (req: Request) => {
  await requirePermission(req, "quality:read");
  const mode = new URL(req.url).searchParams.get("mode") === "replay" ? "replay" : "recorded";
  return json({ mode, ...(await accuracyReport(mode)) });
});
