import { registerWorkerGauges } from "../lib/appMetrics";
import { drainJobs } from "../lib/jobs";
import { runRetention } from "../lib/retention";

// Standalone worker: run one or more of these next to the web app in production.
async function main() {
  console.log("worker started");
  registerWorkerGauges(); // queue/billing health gauges (no-op without telemetry)
  let lastRetention = 0;
  for (;;) {
    if (Date.now() - lastRetention > 6 * 3600_000) {
      lastRetention = Date.now();
      await runRetention(new Date(), console.log).catch((e) => console.error("retention failed", e));
    }
    await drainJobs().catch((e) => console.error(e));
    await new Promise((r) => setTimeout(r, 1500));
  }
}
main();
