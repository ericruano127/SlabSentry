/**
 * Phase 2 end-to-end (live vision service): fingerprint signals, label swap, tilt video,
 * edge review, adaptive retakes, duplicates, AI narrative fallback, bulk queue.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { reserveCredit, usageSummary } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { activeImages, addImage, preflight } from "../lib/sessions";
import { generateNarrative, templateNarrative, validateNarrative } from "../lib/ai/narrate";
import { POST as bulkAnalyze } from "../app/api/sessions/bulk-analyze/route";
import { applyStripeEvent } from "../lib/billing/stripe";
import { newSession, newUser, resetDb, stripeEvent, stripeSub } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const up = await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false);
const run = up && existsSync(`${FIX}/tilt.mp4`);
const file = (n: string) => readFileSync(`${FIX}/${n}`);

async function analyzed(front: string, extra: (u: string, s: string) => Promise<void> = async () => {}, ref = "reference.jpg") {
  const u = await newUser();
  const s = await newSession(u);
  await q(`update verification_sessions set grader='PSA', cert_number='12345678', cert_source='user', cert_confirmed=true where id=$1`, [s]);
  await addImage(u, s, "front", file(front));
  await addImage(u, s, "reference_front", file(ref), { attestation: "Saved from PSA cert page" });
  await extra(u, s);
  await reserveCredit(u, s);
  await enqueueAnalysis(s, 0);
  await drainJobs();
  const sess = (await q(`select * from verification_sessions where id=$1`, [s]))[0];
  const rep = (await q(`select report from verification_reports where session_id=$1 order by analysis_run desc limit 1`, [s]))[0]?.report;
  return { u, s, sess, rep };
}
const obs = (rep: any, id: string) => rep.engine.observations.find((o: any) => o.id === id);

describe.skipIf(!run)("phase 2 pipeline (live vision service)", () => {
  beforeAll(resetDb);
  afterAll(() => pool.end());

  it("unique marks on an otherwise identical copy are flagged and localized", async () => {
    const { rep, sess } = await analyzed("front_marked_copy.jpg");
    expect(sess.status).toBe("completed");
    expect(obs(rep, "fp.front.marks").status).toBe("potential_discrepancy");
    expect(obs(rep, "fp.front.marks").regions.length).toBeGreaterThan(0);
    expect(rep.engine.physicalMatch[0].verdict).toBe("conflicting");
    expect(rep.interpretation.join(" ")).toMatch(/differ from the reference copy/);
    // same label text as the reference: OCR segmentation differences must not look like a label swap
    expect(rep.engine.findings.map((f: any) => f.pattern)).not.toContain("label_modification_possible");
  });

  it("genuine copy: physical match never claimed from artwork alone", async () => {
    const { rep } = await analyzed("front_genuine.jpg");
    const pm = rep.engine.physicalMatch[0];
    expect(pm.verdict).not.toBe("conflicting");
    // clean synthetic edges leave edge-profile inconclusive, so only cut + marks can agree
    if (pm.verdict === "supported") expect(pm.matching.length).toBeGreaterThanOrEqual(2);
  });

  it("label differing from the label in the reference image is flagged", async () => {
    const { rep } = await analyzed("front_label_swap.jpg", async () => {}, "reference_labeled.jpg");
    expect(obs(rep, "tamper.label_vs_reference")?.status).toBe("potential_discrepancy");
    expect(rep.engine.findings.map((f: any) => f.pattern)).toContain("label_modification_possible");
  });

  it("tilt video → distinct frames → holographic analysis; edge close-up reviewed", async () => {
    const { rep, s } = await analyzed("front_genuine.jpg", async (u, s) => {
      const v = await addImage(u, s, "tilt_video", file("tilt.mp4"));
      expect(v.quality.ok).toBe(true);
      await addImage(u, s, "edge", file("edge_clean.jpg"));
    });
    const frames = await q(`select count(*)::int n from submitted_images where session_id=$1 and role='tilt_frame' and not is_original`, [s]);
    expect(frames[0].n).toBeGreaterThanOrEqual(3);
    expect(obs(rep, "capture.tilt_video").status).toBe("consistent");
    expect(obs(rep, "tamper.edge.0").status).toBe("consistent");
    const holder = (await q(`select data from verification_evidence where session_id=$1 and kind='holder' order by created_at desc limit 1`, [s]))[0].data;
    expect(holder.tilt.frames).toBeGreaterThanOrEqual(3);
  });

  it("near-duplicate front/back are not counted and trigger a retake request", async () => {
    const { rep } = await analyzed("front_genuine.jpg", async (u, s) => { await addImage(u, s, "back", file("front_genuine.jpg")); });
    expect(rep.engine.duplicates.map((d: any) => d.role)).toContain("back");
    expect(rep.engine.retakeRequests[0].role).toBe("back");
  });

  it("rejects a static/unusable tilt video before analysis (free)", async () => {
    const u = await newUser();
    const s = await newSession(u);
    await addImage(u, s, "front", file("front_genuine.jpg"));
    // a 'video' made of a still image repeated -> too few distinct frames
    const { execFileSync } = await import("node:child_process");
    execFileSync(`${process.cwd()}/../../services/vision/.venv/bin/python`, ["-c", `import cv2,numpy as np
im=cv2.resize(cv2.imread("${FIX}/front_genuine.jpg"),(480,640));vw=cv2.VideoWriter("/tmp/claude-0/static.mp4",cv2.VideoWriter_fourcc(*"mp4v"),10,(480,640))
[vw.write(im) for _ in range(30)];vw.release()`]);
    await addImage(u, s, "tilt_video", readFileSync("/tmp/claude-0/static.mp4"));
    expect(preflight(await activeImages(s)).map((p) => p.role)).toContain("tilt_video");
    expect((await usageSummary(u)).freeRemaining).toBe(3);
  });

  it("narrative: template fallback without an API key; validator blocks authenticity claims", async () => {
    const { rep } = await analyzed("front_genuine.jpg");
    const n = await generateNarrative(rep);
    expect(n.source).toBe("template");
    expect(n.text).toContain(rep.assessmentLabel);
    expect(validateNarrative(templateNarrative(rep), rep)).toBeNull();
    const bad = `${rep.assessmentLabel}. This slab is genuine and the card is definitely authentic. `.repeat(3);
    expect(validateNarrative(bad, rep)).toBe("forbidden_claim");
    expect(validateNarrative("A fine card with nothing to worry about at all, everything here checks out well enough for most buyers.", rep)).toBe("assessment_not_restated");
  });

  it("bulk queue: Power only, one credit per slab, stops cleanly when credits run out", async () => {
    const u = await newUser();
    const req = (ids: string[]) => new Request("http://x/api/sessions/bulk-analyze", { method: "POST", headers: { "x-dev-user": u, "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    const s1 = await newSession(u);
    await addImage(u, s1, "front", file("front_genuine.jpg"));
    await addImage(u, s1, "back", file("front_different_card.jpg"));
    expect((await bulkAnalyze(req([s1]))).status).toBe(403); // free plan
    const start = new Date();
    await applyStripeEvent(stripeEvent("customer.subscription.created", stripeSub({ userId: u, price: "price_power_month", start, periodEnd: new Date(start.getTime() + 30 * 864e5) }), start));
    await q(`update verification_allowances set used = granted - 1 where user_id=$1 and kind='subscription_period'`, [u]); // 1 period credit left
    await q(`update verification_allowances set used = granted where user_id=$1 and kind='lifetime_free'`, [u]);
    const ids = [s1];
    for (let i = 0; i < 2; i++) { const s = await newSession(u); await addImage(u, s, "front", file("front_genuine.jpg")); await addImage(u, s, "back", file("front_different_card.jpg")); ids.push(s); }
    const blurry = await newSession(u);
    await addImage(u, blurry, "front", file("front_blurry.jpg"));
    ids.push(blurry);
    const res = await (await bulkAnalyze(req(ids))).json();
    const statuses = res.results.map((r: any) => r.status);
    expect(statuses).toEqual(["queued", "limit_reached", "limit_reached", "retake_needed"]);
    expect(res.usage.totalRemaining).toBe(0);
  });
});
