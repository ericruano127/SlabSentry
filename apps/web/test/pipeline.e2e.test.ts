/**
 * End-to-end: upload → quality gate → reserve → vision analysis → rules → report → consume.
 * Requires the vision service (VISION_URL) and fixtures from `python -m tests.make_fixtures`.
 * Skipped automatically when the service is not reachable.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { reserveCredit, usageSummary } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { activeImages, addImage, preflight } from "../lib/sessions";
import { newSession, newUser, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const up = await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false);
const run = up && existsSync(`${FIX}/reference.jpg`);
const img = (n: string) => readFileSync(`${FIX}/${n}`);

describe.skipIf(!run)("analysis pipeline (live vision service)", () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  async function analyze(front: string) {
    const u = await newUser();
    const s = await newSession(u);
    await q(`update verification_sessions set grader='PSA', cert_number='12345678', cert_source='user', cert_confirmed=true where id=$1`, [s]);
    await addImage(u, s, "front", img(front));
    await addImage(u, s, "back", img("front_different_card.jpg")); // front + back are both required
    await addImage(u, s, "reference_front", img("reference.jpg"), { attestation: "Saved from PSA cert page" });
    expect(preflight(await activeImages(s))).toEqual([]);
    await reserveCredit(u, s);
    await enqueueAnalysis(s, 0);
    await drainJobs();
    const sess = (await q(`select * from verification_sessions where id=$1`, [s]))[0];
    const rep = (await q(`select report from verification_reports where session_id=$1 order by analysis_run desc limit 1`, [s]))[0]?.report;
    return { u, s, sess, rep };
  }

  it("genuine copy: report delivered, one credit consumed, no physical-copy conflict", async () => {
    const { u, sess, rep } = await analyze("front_genuine.jpg");
    expect(sess.status).toBe("completed");
    expect(sess.credit_state).toBe("consumed");
    expect(rep.official.imageAvailability).toBe("user_supplied");
    const obs = Object.fromEntries(rep.engine.observations.map((o: any) => [o.id, o.status]));
    expect(obs["ref.front.design"]).toBe("consistent");
    expect(obs["ref.front.centering"]).toBe("consistent");
    expect(obs["cert.code_vs_print"]).toBe("consistent");
    expect(rep.engine.findings.map((f: any) => f.pattern)).not.toContain("different_physical_card");
    expect((await usageSummary(u)).freeUsed).toBe(1);
  });

  it("different physical copy with valid cert: flagged with explanation", async () => {
    const { rep } = await analyze("front_other_copy.jpg");
    const f = rep.engine.findings.find((x: any) => x.pattern === "different_physical_card");
    expect(f).toBeTruthy();
    expect(f.severity).toBe("medium"); // user-supplied reference is never 'high'
    expect(rep.assessmentLabel).toBe("Additional verification recommended");
  });

  it("blurry front is rejected before analysis (no credit involved)", async () => {
    const u = await newUser();
    const s = await newSession(u);
    await addImage(u, s, "front", img("front_blurry.jpg"));
    const problems = preflight(await activeImages(s));
    expect(problems[0].issues.map((i: any) => i.issue)).toContain("blur");
    expect((await usageSummary(u)).freeRemaining).toBe(3);
  });

  it("retake in the same session re-runs without another credit", async () => {
    const { u, s } = await analyze("front_genuine.jpg");
    await addImage(u, s, "front", img("front_genuine.jpg"));
    expect((await reserveCredit(u, s)).status).toBe("already_consumed");
    await enqueueAnalysis(s, 0);
    await drainJobs();
    expect((await q(`select analysis_count from verification_sessions where id=$1`, [s]))[0].analysis_count).toBe(2);
    expect((await usageSummary(u)).freeUsed).toBe(1);
  });
});
