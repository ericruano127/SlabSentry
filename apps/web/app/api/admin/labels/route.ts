import { z } from "zod";
import { one, q } from "@/lib/db";
import { handle, HttpError, json } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";

/**
 * Ground-truth labeling. A session may be labeled only if its photos may be used for model work:
 * at least one upload is training-eligible (user consent at upload AND still consented), or it is an
 * internal sample uploaded by staff. Labels record how the truth was established.
 */
const ELIGIBLE = `(exists (select 1 from training_eligible_images t where t.session_id = s.id) or exists (select 1 from app_users o where o.id = s.user_id and o.role <> 'user'))`;

export const GET = handle(async (req: Request) => {
  const u = await requirePermission(req, "quality:label");
  const queue = await q(
    `select s.id, s.category, s.grader, s.title, s.overall_assessment, s.completed_at,
            (select count(*)::int from ground_truth_labels l where l.session_id=s.id) labels
       from verification_sessions s
      where s.status='completed' and ${ELIGIBLE}
        and not exists (select 1 from ground_truth_labels l where l.session_id=s.id and l.labeled_by=$1)
      order by s.completed_at desc limit 50`, [u.id]);
  const disputed = await q(`select session_id, array_agg(truth) truths from ground_truth_labels group by session_id having count(distinct truth) > 1`);
  return json({ queue, disputed });
});

export const POST = handle(async (req: Request) => {
  const u = await requirePermission(req, "quality:label");
  const b = z.object({
    sessionId: z.string().uuid(),
    truth: z.enum(["genuine", "counterfeit", "altered"]),
    basis: z.enum(["grader_confirmation", "grader_submission_result", "expert_inspection", "law_enforcement_or_marketplace", "internal_test_sample"]),
    note: z.string().min(10).max(2000),
  }).parse(await req.json());
  const ok = await one(`select 1 from verification_sessions s where s.id=$1 and ${ELIGIBLE}`, [b.sessionId]);
  if (!ok) throw new HttpError(403, "not_consented", "This session's photos aren't consented for model work, so it can't be added to the labeled set.");
  await q(`insert into ground_truth_labels (session_id,truth,basis,note,labeled_by) values ($1,$2,$3,$4,$5)
           on conflict (session_id,labeled_by) do update set truth=excluded.truth, basis=excluded.basis, note=excluded.note, created_at=now()`,
    [b.sessionId, b.truth, b.basis, b.note, u.id]);
  await q(`insert into admin_audit_log (admin_id,action,after) values ($1,'label.set',$2)`, [u.id, JSON.stringify(b)]);
  return json({ ok: true }, 201);
});
