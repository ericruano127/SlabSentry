import { evaluateAccuracy, runEngine, type AccuracyReport, type CompiledLibrary, type EngineInput, type GroundTruth, type LabeledOutcome } from "@slabguard/core";
import { q } from "./db";
import { loadLibrary } from "./library";

export const MISSED_FAKE_WEIGHT = Number(process.env.MISSED_FAKE_WEIGHT ?? 5);

/** Consensus ground truth: sessions whose labels all agree. Disagreements are excluded until adjudicated. */
export async function consensusLabels() {
  const rows = await q(`select session_id, array_agg(distinct truth) truths, count(*)::int labels from ground_truth_labels group by session_id`);
  const agreed = rows.filter((r) => r.truths.length === 1).map((r) => ({ sessionId: r.session_id as string, truth: r.truths[0] as GroundTruth, labels: r.labels as number }));
  return { agreed, disputed: rows.filter((r) => r.truths.length > 1).map((r) => r.session_id as string) };
}

/**
 * Outcomes for the labeled set.
 *  - "recorded": what the delivered reports actually said (historical accuracy)
 *  - "replay":   re-run the rules engine on each session's stored engine inputs with `lib`
 *                (evaluates a new rules/library release before it ships; vision changes need re-runs)
 */
export async function labeledOutcomes(mode: "recorded" | "replay", lib?: CompiledLibrary): Promise<{ rows: LabeledOutcome[]; missingInputs: number }> {
  const { agreed } = await consensusLabels();
  if (!agreed.length) return { rows: [], missingInputs: 0 };
  const ids = agreed.map((a) => a.sessionId);
  const sessions = new Map((await q(`select id, category, grader from verification_sessions where id = any($1)`, [ids])).map((s) => [s.id, s]));
  const rows: LabeledOutcome[] = [];
  let missing = 0;
  if (mode === "recorded") {
    const reps = await q(`select distinct on (session_id) session_id, report from verification_reports where session_id = any($1) order by session_id, analysis_run desc`, [ids]);
    const byId = new Map(reps.map((r) => [r.session_id, r.report]));
    for (const a of agreed) {
      const rep = byId.get(a.sessionId);
      if (!rep) { missing++; continue; }
      const s = sessions.get(a.sessionId);
      rows.push({ sessionId: a.sessionId, truth: a.truth, assessment: rep.engine.assessment, category: rep.category ?? s?.category, grader: rep.identification?.grader ?? s?.grader ?? null, generation: rep.engine.era?.generation?.id ?? null });
    }
  } else {
    const library = lib ?? (await loadLibrary());
    const snaps = await q(`select distinct on (session_id) session_id, data from verification_evidence where kind='engine_input' and session_id = any($1) order by session_id, created_at desc`, [ids]);
    const byId = new Map(snaps.map((r) => [r.session_id, r.data]));
    for (const a of agreed) {
      const snap = byId.get(a.sessionId) as EngineInput | undefined;
      if (!snap) { missing++; continue; }
      const out = runEngine({ ...snap, library });
      rows.push({ sessionId: a.sessionId, truth: a.truth, assessment: out.assessment, category: out.category, grader: snap.grader, generation: out.era?.generation?.id ?? null });
    }
  }
  return { rows, missingInputs: missing };
}

export async function accuracyReport(mode: "recorded" | "replay", lib?: CompiledLibrary): Promise<AccuracyReport & { missingInputs: number; disputed: number }> {
  const { rows, missingInputs } = await labeledOutcomes(mode, lib);
  const { disputed } = await consensusLabels();
  return { ...evaluateAccuracy(rows, MISSED_FAKE_WEIGHT), missingInputs, disputed: disputed.length };
}
