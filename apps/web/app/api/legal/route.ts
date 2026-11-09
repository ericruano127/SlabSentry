import { currentDocs } from "@/lib/consent";
import { handle, json } from "@/lib/http";

/** Public: currently published legal documents (versions + text). */
export const GET = handle(async () => {
  const docs = await currentDocs();
  return json({ documents: docs.map((d) => ({ kind: d.kind, version: d.version, title: d.title, body: d.body_md, requiresAcceptance: d.requires_acceptance, pendingLegalReview: d.legal_review_status !== "approved" })) });
});
