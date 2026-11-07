import { one, q } from "./db";
import { env } from "./env";
import { releaseCredit } from "./credits";
import { runAnalysis } from "./pipeline";
import { VisionUnavailable } from "./vision";

const MAX_ATTEMPTS = 3;

export async function enqueueAnalysis(sessionId: string, priority: number) {
  await q(`insert into jobs (kind,payload,priority) values ('analyze',$1,$2)`, [JSON.stringify({ sessionId }), priority]);
  if (env.inlineWorker) void drainJobs();
}

let draining = false;
/** Claim and run queued jobs (FOR UPDATE SKIP LOCKED makes multiple workers safe). */
export async function drainJobs(max = 50) {
  if (draining) return;
  draining = true;
  try {
    for (let i = 0; i < max; i++) {
      const job = await one(
        `update jobs set status='running', attempts=attempts+1, locked_at=now() where id = (
           select id from jobs where (status='queued' and run_after <= now()) or (status='running' and locked_at < now() - interval '10 minutes')
           order by priority desc, id limit 1 for update skip locked) returning *`,
      );
      if (!job) break;
      await runJob(job);
    }
  } finally {
    draining = false;
  }
}

async function runJob(job: any) {
  const { sessionId } = job.payload;
  try {
    await runAnalysis(sessionId);
    await q(`update jobs set status='done' where id=$1`, [job.id]);
  } catch (e: any) {
    const retry = e instanceof VisionUnavailable && job.attempts < MAX_ATTEMPTS;
    const s = await one(`select user_id from verification_sessions where id=$1`, [sessionId]);
    if (retry) {
      await q(`update jobs set status='queued', run_after=now() + make_interval(secs => $2), last_error=$3 where id=$1`, [job.id, 20 * job.attempts, String(e.message)]);
      await q(`update verification_sessions set status='queued' where id=$1`, [sessionId]);
      return;
    }
    console.error("analysis failed", sessionId, e);
    await q(`update jobs set status='failed', last_error=$2 where id=$1`, [job.id, String(e.message)]);
    const msg = e.userFacing ? e.message : e instanceof VisionUnavailable ? "Our analysis service is temporarily unavailable." : "Analysis failed due to a server error.";
    await q(`update verification_sessions set status='failed', error=$2, updated_at=now() where id=$1`, [sessionId, `${msg} No verification credit was used.`]);
    if (s) await releaseCredit(s.user_id, sessionId, e.userFacing ? "user_error" : "analysis_failed");
  }
}
