/**
 * Analysis throughput benchmark (capacity planning). Seeds N ready sessions (front + back + reference,
 * cert confirmed), enqueues them, then starts W worker processes and measures wall time per batch.
 * Each batch uses fresh sessions (analysis evidence is cached per session, so re-running would be warm).
 * Use a dedicated database — it is reset. INLINE_WORKER=0 is required so seeding does not analyse inline.
 *
 *   cd apps/web && INLINE_WORKER=0 DATABASE_URL=postgres://…/slabguard_bench VISION_URL=http://127.0.0.1:8001 \
 *     npx tsx ../../loadtest/local/analysis-bench.ts --sessions 24 --workers 1,2,4
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pool, q } from "../../apps/web/lib/db";
import { reserveCredit } from "../../apps/web/lib/credits";
import { enqueueAnalysis } from "../../apps/web/lib/jobs";
import { addImage } from "../../apps/web/lib/sessions";
import { newSession, newUser, resetDb } from "../../apps/web/test/helpers";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt("sessions", "24"));
const WORKERS = opt("workers", "1,2,4").split(",").map(Number);
const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const img = (n: string) => readFileSync(`${FIX}/${n}`);
const web = path.resolve(__dirname, "../../apps/web");

async function seed(n: number) {
  if (process.env.INLINE_WORKER !== "0") throw new Error("set INLINE_WORKER=0");
  for (let i = 0; i < n; i++) {
    const u = await newUser();
    const s = await newSession(u);
    await q(`update verification_sessions set grader='PSA', cert_number='12345678', cert_source='user', cert_confirmed=true where id=$1`, [s]);
    await addImage(u, s, "front", img(i % 2 ? "front_genuine.jpg" : "front_other_copy.jpg"));
    await addImage(u, s, "back", img("front_different_card.jpg"));
    await addImage(u, s, "reference_front", img("reference.jpg"), { attestation: "bench" });
    await reserveCredit(u, s);
    await enqueueAnalysis(s, 0);
  }
}

async function batch(workers: number) {
  await q(`delete from jobs`);
  await seed(N);
  const t0 = Date.now();
  const procs = Array.from({ length: workers }, () =>
    spawn("npx", ["tsx", "scripts/worker.ts"], { cwd: web, env: { ...process.env, INLINE_WORKER: "0" }, stdio: "ignore", detached: true }));
  // kill the whole process group (npx → tsx → node), otherwise orphaned workers keep draining later batches
  const stop = () => procs.forEach((p) => { try { process.kill(-p.pid!, "SIGTERM"); } catch {} });
  process.on("exit", stop);
  for (;;) {
    const [r] = await q(`select count(*) filter (where status in ('queued','running'))::int open, count(*) filter (where status='failed')::int failed from jobs`);
    if (!r.open) { stop(); break; }
    await new Promise((res) => setTimeout(res, 250));
  }
  const wall = (Date.now() - t0) / 1000;
  const [d] = await q(`select percentile_cont(0.5) within group (order by extract(epoch from finished_at-started_at)) p50,
                              percentile_cont(0.95) within group (order by extract(epoch from finished_at-started_at)) p95,
                              count(*) filter (where status='failed')::int failed from jobs`);
  const r = { workers, sessions: N, wallSec: +wall.toFixed(1), perMinute: +((N / wall) * 60).toFixed(1), jobP50: +Number(d.p50).toFixed(2), jobP95: +Number(d.p95).toFixed(2), failed: d.failed };
  console.log(JSON.stringify(r));
  return r;
}

(async () => {
  await resetDb();
  for (const w of WORKERS) await batch(w);
  await pool.end();
})();
