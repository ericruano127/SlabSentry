import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { appMetrics } from "./appMetrics";
import { one, q } from "./db";
import { env } from "./env";
import { releaseCredit } from "./credits";
import { runAnalysis } from "./pipeline";
import { VisionUnavailable } from "./vision";
import { reportError } from "./log";

const MAX_ATTEMPTS = 3;
const tracer = trace.getTracer("slabsentry");

export async function enqueueAnalysis(sessionId: string, priority: number) {
  await q(`insert into jobs (kind,payload,priority) values ('analyze',$1,$2)`, [JSON.stringify({ sessionId }), priority]);
  await q(`update verification_sessions set progress=5, stage='Waiting in queue' where id=$1`, [sessionId]);
  if (env.inlineWorker) void drainJobs();
}

let draining = false;
let stopping = false;
let current: Promise<void> | null = null;

/** Graceful shutdown: claim no new jobs, and resolve once the job in progress has finished. */
export function stopAfterCurrentJob(): Promise<void> {
  stopping = true;
  return current ?? Promise.resolve();
}
export const isStopping = () => stopping;

/** Liveness: updated every loop tick and after each job, so a hung worker can be detected and restarted. */
let lastActivity = Date.now();
export const markActivity = () => { lastActivity = Date.now(); };
export const lastActivityAt = () => lastActivity;

/** Claim and run queued jobs (FOR UPDATE SKIP LOCKED makes multiple workers safe). */
export function drainJobs(max = 50): Promise<void> {
  if (draining) return current ?? Promise.resolve();
  draining = true;
  current = drainLoop(max).finally(() => { draining = false; current = null; });
  return current;
}

async function drainLoop(max: number) {
  for (let i = 0; i < max && !stopping; i++) {
      const job = await one(
        `update jobs set status='running', attempts=attempts+1, locked_at=now(), started_at=now() where id = (
           select id from jobs where (status='queued' and run_after <= now()) or (status='running' and locked_at < now() - interval '10 minutes')
           order by priority desc, id limit 1 for update skip locked) returning *`,
      );
    if (!job) break;
    await runJob(job);
    markActivity();
  }
}

/** One trace per analysis job: pipeline stages appear as span events; vision calls, database queries
 * and grader lookups appear as child spans (with redacted URLs). */
function runJob(job: any) {
  return tracer.startActiveSpan("analysis.job", { kind: SpanKind.CONSUMER, attributes: { "job.id": String(job.id), "session.id": job.payload.sessionId, "job.attempt": job.attempts } }, async (span) => {
    const t0 = performance.now();
    let outcome = "done";
    try {
      outcome = await runJobInner(job);
    } catch (e) {
      outcome = "error";
      span.recordException(e as Error);
      throw e;
    } finally {
      span.setAttribute("job.outcome", outcome);
      if (outcome !== "done" && outcome !== "retry") span.setStatus({ code: SpanStatusCode.ERROR, message: outcome });
      appMetrics.analyses.add(1, { outcome });
      appMetrics.analysisDuration.record((performance.now() - t0) / 1000, { outcome });
      span.end();
    }
  });
}

async function runJobInner(job: any): Promise<string> {
  const { sessionId } = job.payload;
  try {
    await runAnalysis(sessionId);
    await q(`update jobs set status='done', finished_at=now() where id=$1`, [job.id]);
    return "done";
  } catch (e: any) {
    const retry = e instanceof VisionUnavailable && job.attempts < MAX_ATTEMPTS;
    const s = await one(`select user_id from verification_sessions where id=$1`, [sessionId]);
    if (retry) {
      await q(`update jobs set status='queued', run_after=now() + make_interval(secs => $2), last_error=$3 where id=$1`, [job.id, 20 * job.attempts, String(e.message)]);
      await q(`update verification_sessions set status='queued' where id=$1`, [sessionId]);
      return "retry";
    }
    await q(`update jobs set status='failed', finished_at=now(), last_error=$2 where id=$1`, [job.id, String(e.message)]);
    reportError(e, { route: "job:analyze", sessionId });
    const msg = e.userFacing ? e.message : e instanceof VisionUnavailable ? "Our analysis service is temporarily unavailable." : "Analysis failed due to a server error.";
    await q(`update verification_sessions set status='failed', error=$2, updated_at=now() where id=$1`, [sessionId, `${msg} No verification credit was used.`]);
    if (s) await releaseCredit(s.user_id, sessionId, e.userFacing ? "user_error" : "analysis_failed");
    trace.getActiveSpan()?.recordException(e);
    return e.userFacing ? "user_error" : e instanceof VisionUnavailable ? "vision_unavailable" : "failed";
  }
}
