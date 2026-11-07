import { drainJobs } from "../lib/jobs";

// Standalone worker: run one or more of these next to the web app in production.
async function main() {
  console.log("worker started");
  for (;;) {
    await drainJobs().catch((e) => console.error(e));
    await new Promise((r) => setTimeout(r, 1500));
  }
}
main();
