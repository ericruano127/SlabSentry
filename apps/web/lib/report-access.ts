import { hasFeature } from "@slabguard/core";
import { entitlementsFor } from "./credits";
import { one } from "./db";
import { HttpError } from "./http";
import { renderReportsPdf } from "./pdf";
import { storage } from "./storage";

export async function pdfForSessions(userId: string, ids: string[], feature: "pdf_export" | "batch_pdf_export") {
  const { ent } = await entitlementsFor(userId);
  if (!hasFeature(ent, feature)) throw new HttpError(403, "upgrade_required", feature === "pdf_export" ? "PDF export is included with Collector Pro and Power Collector." : "Batch PDF export is included with Power Collector.", { upgrade: true });
  const items = [];
  for (const id of ids) {
    const r = await one(`select r.report from verification_reports r join verification_sessions s on s.id=r.session_id where s.id=$1 and s.user_id=$2 order by r.analysis_run desc limit 1`, [id, userId]);
    if (!r) continue;
    const ovId = r.report.engine.observations.find((o: any) => o.id === "ref.front.design")?.imageRefs?.[0];
    const ov = ovId ? await one(`select storage_key from submitted_images where id=$1 and user_id=$2`, [ovId, userId]) : null;
    items.push({ report: r.report, overlayPng: ov ? await storage.get(ov.storage_key).catch(() => null) : null });
  }
  if (!items.length) throw new HttpError(404, "no_reports", "No completed reports found.");
  return renderReportsPdf(items);
}
