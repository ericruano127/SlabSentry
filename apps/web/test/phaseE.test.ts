/** Phase E: releases with public/internal changelogs + accuracy gate, ground-truth labeling with
 * consent enforcement, replay evaluation, release version on reports. */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { reserveCredit } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { addImage } from "../lib/sessions";
import { accuracyReport } from "../lib/evaluation";
import { GET as releasesPublic } from "../app/api/releases/route";
import { POST as releasePOST } from "../app/api/admin/releases/route";
import { POST as publishPOST } from "../app/api/admin/releases/[id]/publish/route";
import { POST as labelPOST } from "../app/api/admin/labels/route";
import { PATCH as consentPATCH } from "../app/api/consent/route";
import { newSession, newUser, req, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const vision = (await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false)) && existsSync(`${FIX}/front_different_card.jpg`);
const file = (n: string) => readFileSync(`${FIX}/${n}`);
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(resetDb);
afterAll(() => pool.end());

async function staff(role: string) { const u = await newUser(); await q(`update app_users set role=$2 where id=$1`, [u, role]); return u; }

/** A completed session with a stored engine-input snapshot that replays to the given strength of evidence. */
async function labeledFixture(owner: string, strong: boolean) {
  const s = await newSession(owner);
  const ok = { ok: true, score: 1, issues: [], metrics: {} };
  const snap = {
    mode: "in_hand", grader: "PSA", certNumber: "12345678", certSource: "qr", certUserConfirmed: true,
    record: strong ? { grader: "PSA", certNumber: "12345678", found: true, grade: "10", verificationUrl: "x", provenance: { source: "official_api", retrievedAt: "x" } } : null,
    labelOcrText: ["GEM MT 10"], images: [{ id: "f", role: "front", quality: ok }, { id: "b", role: "back", quality: ok }],
    comparisons: strong ? [{ side: "front", referenceSource: "official_api", result: { designMatch: { status: "consistent", inliers: 300, inlierRatio: 0.6 }, photoReuse: { hammingFull: 25, hammingCard: 25, nearIdentical: false }, centering: { status: "consistent", edgeOffsetPct: 0.2 }, localDifferences: { status: "consistent", flaggedRegions: [], glareMaskedPct: 1, comparableAreaPct: 90 }, overlays: {}, toolVersion: "t" } }] : [],
    holder: { slabDetected: true, edgesVisible: { top: true, bottom: true, left: true, right: true }, edgeStraightness: { maxDeviationPct: 0.1, status: "consistent" }, codes: [{ type: "qr", data: "https://www.psacard.com/cert/12345678" }], ocrText: [], toolVersion: "t" },
    category: "tcg",
  };
  await q(`update verification_sessions set status='completed', category='tcg', grader='PSA', completed_at=now() where id=$1`, [s]);
  await q(`insert into verification_evidence (session_id,analysis_run,kind,data,provenance) values ($1,1,'engine_input',$2,'{}')`, [s, JSON.stringify(snap)]);
  return s;
}

describe("ground truth labeling", () => {
  it("requires consent for model work (or a staff-owned internal sample) and records how truth was established", async () => {
    const analyst = await staff("analyst");
    const user = await newUser();
    const s = await labeledFixture(user, true);
    const body = { sessionId: s, truth: "genuine", basis: "grader_confirmation", note: "Grader confirmed the slab by email" };
    expect((await labelPOST(req("/api/admin/labels", analyst, { method: "POST", aal2: true, json: body }))).status).toBe(403); // no training consent
    await consentPATCH(req("/api/consent", user, { method: "PATCH", json: { training: true } }));
    await q(`insert into submitted_images (session_id,user_id,role,storage_key,mime,bytes,sha256,provenance,training_consent,consent_version) values ($1,$2,'front','k','image/jpeg',1,'x','{}',true,'2026-11-draft-1')`, [s, user]);
    expect((await labelPOST(req("/api/admin/labels", analyst, { method: "POST", aal2: true, json: body }))).status).toBe(201);
    const internal = await labeledFixture(analyst, true); // staff-owned test sample
    expect((await labelPOST(req("/api/admin/labels", analyst, { method: "POST", aal2: true, json: { ...body, sessionId: internal, basis: "internal_test_sample" } }))).status).toBe(201);
  });

  it("disagreeing labels are excluded until adjudicated", async () => {
    const a1 = await staff("analyst"), a2 = await staff("analyst");
    const s = await labeledFixture(a1, false);
    await labelPOST(req("/api/admin/labels", a1, { method: "POST", aal2: true, json: { sessionId: s, truth: "genuine", basis: "internal_test_sample", note: "internal sample A" } }));
    await labelPOST(req("/api/admin/labels", a2, { method: "POST", aal2: true, json: { sessionId: s, truth: "counterfeit", basis: "internal_test_sample", note: "internal sample A" } }));
    const acc = await accuracyReport("replay");
    expect(acc.disputed).toBe(1);
    expect(acc.overall.n).toBe(2); // the two agreed sessions from the previous test only
  });
});

describe("releases", () => {
  it("public notes are linted; components, accuracy and gate are recorded; published releases are immutable", async () => {
    const admin = await staff("admin"), owner = await staff("owner");
    const leaky = await releasePOST(req("/api/admin/releases", admin, { method: "POST", aal2: true, json: { version: "2026.11.4", publicNotes: "Lowered the pHash hamming threshold to 18.", internalNotes: "Tuned perceptual hash distance from 20 to 18 after review." } }));
    expect(leaky.status).toBe(400);
    const r1 = await (await releasePOST(req("/api/admin/releases", admin, { method: "POST", aal2: true, json: { version: "2026.11.4", publicNotes: "Improved checks for trading card slabs and clearer photo guidance.", internalNotes: "Phase D: motion blur + label sharpness gates; quick/deep flow; summary card." } }))).json();
    const rel = (await q(`select * from releases where id=$1`, [r1.id]))[0];
    expect(rel.components.rules).toMatch(/^rules-/);
    expect(rel.components.library.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rel.accuracy.overall.n).toBe(2);
    expect(rel.gate.pass).toBe(true);
    expect((await publishPOST(req(`/api/admin/releases/${r1.id}/publish`, admin, { method: "POST", aal2: true, json: {} }), ctx(r1.id))).status).toBe(200);
    await expect(q(`update releases set public_notes='x' where id=$1`, [r1.id])).rejects.toThrow(/immutable/);
    const pub = await (await releasesPublic()).json();
    expect(pub.current).toBe("2026.11.4");
    expect(JSON.stringify(pub)).not.toContain("motion blur + label sharpness"); // internal notes never public

    // A new confirmed counterfeit that the current rules clear → missed fake → gate blocks the next release.
    const fake = await labeledFixture(owner, true);
    await labelPOST(req("/api/admin/labels", owner, { method: "POST", aal2: true, json: { sessionId: fake, truth: "counterfeit", basis: "grader_submission_result", note: "Grader rejected as counterfeit holder" } }));
    const r2 = await (await releasePOST(req("/api/admin/releases", admin, { method: "POST", aal2: true, json: { version: "2026.11.5", publicNotes: "Small improvements to report wording.", internalNotes: "Copy edits only; evaluated against the labeled set." } }))).json();
    expect(r2.gate.pass).toBe(false);
    expect(r2.gate.reasons.join()).toMatch(/Missed fakes increased/);
    expect((await publishPOST(req(`/api/admin/releases/${r2.id}/publish`, admin, { method: "POST", aal2: true, json: {} }), ctx(r2.id))).status).toBe(409);
    expect((await publishPOST(req(`/api/admin/releases/${r2.id}/publish`, admin, { method: "POST", aal2: true, json: { overrideReason: "Accepting temporarily" } }), ctx(r2.id))).status).toBe(403);
    expect((await publishPOST(req(`/api/admin/releases/${r2.id}/publish`, owner, { method: "POST", aal2: true, json: { overrideReason: "Wording-only release; missed fake tracked in technique log" } }), ctx(r2.id))).status).toBe(200);
    expect((await q(`select gate_override_reason from releases where id=$1`, [r2.id]))[0].gate_override_reason).toMatch(/Wording-only/);
  });

  it.skipIf(!vision)("reports record the release that produced them and store a replayable engine snapshot", async () => {
    const u = await newUser();
    const s = await newSession(u);
    await q(`update verification_sessions set grader='PSA', cert_number='12345678', cert_confirmed=true where id=$1`, [s]);
    await addImage(u, s, "front", file("front_genuine.jpg"));
    await addImage(u, s, "back", file("front_different_card.jpg"));
    await reserveCredit(u, s);
    await enqueueAnalysis(s, 0);
    await drainJobs();
    const r = (await q(`select report, release_version from verification_reports where session_id=$1`, [s]))[0];
    expect(r.release_version).toBe("2026.11.5");
    expect(r.report.releaseVersion).toBe("2026.11.5");
    const snap = (await q(`select data from verification_evidence where session_id=$1 and kind='engine_input'`, [s]))[0].data;
    expect(snap.library).toBeUndefined();
    expect(snap.libraryVersion).toBeTruthy();
  });
});
