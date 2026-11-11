import { registerWorkerGauges } from "../lib/appMetrics";
import { createServer } from "node:http";
import { drainJobs, isStopping, lastActivityAt, markActivity, stopAfterCurrentJob } from "../lib/jobs";
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

/** Optional health endpoint (WORKER_HEALTH_PORT) for platform health checks: 200 while the job loop
 * is making progress, 503 if it has been stuck longer than WORKER_STUCK_MS (default 5 min) or is stopping. */
function startHealthServer() {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 0);
  if (!port) return;
  const stuckMs = Number(process.env.WORKER_STUCK_MS ?? 300_000);
  createServer((req, res) => {
    const idle = Date.now() - lastActivityAt();
    const ok = req.url === "/health" && !isStopping() && idle < stuckMs;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok, idleMs: idle, stopping: isStopping() }));
  }).listen(port, "0.0.0.0");
}

async function main() {
  console.log("worker started");
  startHealthServer();
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
    markActivity();
    await new Promise((r) => setTimeout(r, 1500));
  }
}
main();
