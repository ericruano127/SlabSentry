/** Graceful worker shutdown: the job in progress finishes; no new job is claimed (own file: module state). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { drainJobs, enqueueAnalysis, isStopping, stopAfterCurrentJob } from "../lib/jobs";
import { newSession, newUser, resetDb } from "./helpers";

beforeAll(resetDb);
afterAll(() => pool.end());

describe("graceful shutdown", () => {
  it("finishes the current job, claims no more, and leaves the rest queued for another worker", async () => {
    const u = await newUser();
    const sessions = [await newSession(u), await newSession(u), await newSession(u)];
    for (const s of sessions) await enqueueAnalysis(s, 0); // no photos → each job fails fast ("front image missing")
    const drain = drainJobs();
    const stopped = stopAfterCurrentJob(); // SIGTERM arrives while the first job runs
    await stopped;
    await drain;
    expect(isStopping()).toBe(true);
    const rows = await q(`select status from jobs order by id`);
    expect(rows.filter((r) => r.status === "queued").length).toBe(2); // untouched, ready for another worker
    expect(rows.filter((r) => r.status === "running").length).toBe(0); // nothing abandoned mid-run
    await drainJobs(); // a stopping worker never claims again
    expect((await q(`select count(*)::int n from jobs where status='queued'`))[0].n).toBe(2);
  });
});
