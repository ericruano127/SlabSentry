import { registerWorkerGauges } from "../lib/appMetrics";
import { drainJobs, isStopping, stopAfterCurrentJob } from "../lib/jobs";
import { runRetention } from "../lib/retention";
import { deferTelemetryShutdown, shutdownTelemetry } from "../lib/telemetry.mjs";

// Standalone worker: run one or more of these next to the web app in production.
// Graceful shutdown (deploys, scale-down): on SIGTERM, claim no new jobs, finish the current analysis
// (Fly allows 30 s; an analysis takes ~5 s), flush telemetry, then exit. Without this the job in progress
// stays "running" for 10 minutes before another worker retries it.
const GRACE_MS = Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? 25_000);

async function shutdown(signal: string) {
  console.log(`worker: ${signal} received, finishing the current job`);
  const finished = await Promise.race([stopAfterCurrentJob().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), GRACE_MS).unref())]);
  if (!finished) console.log("worker: grace period ended with a job still running (it will be retried after its lock expires)");
  await shutdownTelemetry();
  process.exit(0);
}

async function main() {
  console.log("worker started");
  deferTelemetryShutdown();
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  registerWorkerGauges(); // queue/billing health gauges (no-op without telemetry)
  let lastRetention = 0;
  while (!isStopping()) {
    if (Date.now() - lastRetention > 6 * 3600_000) {
      lastRetention = Date.now();
      await runRetention(new Date(), console.log).catch((e) => console.error("retention failed", e));
    }
    await drainJobs().catch((e) => console.error(e));
    await new Promise((r) => setTimeout(r, 1500));
  }
}
main();
