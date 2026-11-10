import { officialLookupUrl, type GraderId } from "@slabguard/core";
import { loadLibrary } from "./library";
import { one, q } from "./db";

export async function sessionView(s: any) {
  const lib = await loadLibrary();
  const images = await q(`select id, role, is_original, derived_from, quality, provenance, superseded, created_at from submitted_images where session_id=$1 order by created_at`, [s.id]);
  const report = await one(`select analysis_run, report, created_at, share_token from verification_reports where session_id=$1 order by analysis_run desc limit 1`, [s.id]);
  const history = await q(`select analysis_run, report->'engine'->>'assessment' as assessment, report->'engine'->'evidenceQuality'->>'level' as evidence, created_at from verification_reports where session_id=$1 order by analysis_run`, [s.id]);
  const refs = await q(`select side, source, availability, source_url, attestation, image_id, retrieved_at from official_reference_images where session_id=$1`, [s.id]);
  const queue = s.status === "queued"
    ? (await one(`with mine as (select id, priority from jobs where status='queued' and payload->>'sessionId'=$1 order by id desc limit 1)
                  select count(*)::int ahead from jobs j, mine where j.status in ('queued','running') and (j.priority > mine.priority or (j.priority = mine.priority and j.id < mine.id))`, [s.id]))?.ahead ?? 0
    : null;
  return {
    progress: { percent: s.progress, stage: s.stage, queueAhead: queue },
    id: s.id, mode: s.mode, status: s.status, title: s.title, grader: s.grader, certNumber: s.cert_number, certSource: s.cert_source, certConfirmed: s.cert_confirmed,
    lockedCert: s.locked_cert, creditState: s.credit_state, analysisCount: s.analysis_count, overallAssessment: s.overall_assessment, error: s.error,
    createdAt: s.created_at, completedAt: s.completed_at,
    category: s.category,
    officialLookupUrl: s.grader && s.cert_number ? officialLookupUrl(s.grader as GraderId, s.cert_number, lib) : s.grader ? lib.grader(s.grader)?.lookupBaseUrl ?? null : null,
    images: images.filter((i) => !i.superseded),
    references: refs,
    report: report?.report ?? null,
    shareToken: report?.share_token ?? null,
    assessmentHistory: history,
  };
}
