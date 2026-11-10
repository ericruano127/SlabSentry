/** Reference library admin: template submission with automatic checks, two-person review, use of
 * approved templates only (best-matching variant), retirement, and the release fingerprint. */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { reserveCredit } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { addImage } from "../lib/sessions";
import { currentComponents } from "../lib/releases";
import { GET as listGET, POST as submitPOST } from "../app/api/admin/templates/route";
import { POST as reviewPOST } from "../app/api/admin/templates/[id]/review/route";
import { POST as retirePOST } from "../app/api/admin/templates/[id]/retire/route";
import { GET as imageGET } from "../app/api/admin/templates/[id]/image/route";
import { GET as detailGET } from "../app/api/admin/templates/[id]/route";
import { withMetadata } from "./exif-fixture";
import { newSession, newUser, req, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const run = (await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false)) && existsSync(`${FIX}/uv_label.jpg`);
const file = (n: string) => readFileSync(`${FIX}/${n}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function staff(role: string) {
  const u = await newUser();
  await q(`update app_users set role=$2 where id=$1`, [u, role]);
  return u;
}
/** Multipart upload, as the admin page sends it. */
function upload(u: string, photo: Buffer, fields: Record<string, string>) {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "slab.jpg");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return submitPOST(req("/api/admin/templates", u, { method: "POST", aal2: true, body: fd }));
}
const review = (u: string, id: string, decision: "approve" | "reject", note = "Checked against the grader record") =>
  reviewPOST(req(`/api/admin/templates/${id}/review`, u, { method: "POST", aal2: true, json: { decision, note } }), ctx(id));
const label = (extra: Record<string, string> = {}) => ({ generationId: "tag_current", kind: "label", evidenceType: "submitted_by_us", note: "Submitted by us to the grader; cert verified (test)", ...extra });

async function analyzeTag(front: string) {
  const u = await newUser();
  const s = await newSession(u);
  await q(`update verification_sessions set grader='TAG', cert_number='T2000001', cert_source='user', cert_confirmed=true, category='tcg' where id=$1`, [s]);
  await addImage(u, s, "front", file(front));
  await reserveCredit(u, s);
  await enqueueAnalysis(s, 0);
  await drainJobs();
  const rep = (await q(`select report from verification_reports where session_id=$1 order by analysis_run desc limit 1`, [s]))[0].report;
  return (id: string) => rep.engine.observations.find((o: any) => o.id === id);
}

beforeAll(async () => { if (run) await resetDb(); });
afterAll(() => pool.end());

describe.skipIf(!run)("reference library admin (live vision service)", () => {
  let analyst: string, adminA: string, adminB: string, regularId: string;

  it("analysts submit; automatic checks run; metadata is stripped; the submitter can't approve their own", async () => {
    [analyst, adminA, adminB] = [await staff("analyst"), await staff("admin"), await staff("admin")];
    const r = await upload(analyst, withMetadata(file("reference_labeled.jpg"), 1), label({ variant: "regular", certNumber: "T1000001" }));
    expect(r.status).toBe(201);
    const t = await r.json();
    regularId = t.id;
    expect(t.status).toBe("pending");
    expect(t.consistency.verdict).toBe("first");
    const src = Buffer.from(await (await imageGET(req(`/api/admin/templates/${t.id}/image?which=source`, adminA, { aal2: true }), ctx(t.id))).arrayBuffer());
    expect(src.includes(Buffer.from("Adobe Photoshop"))).toBe(false); // EXIF/XMP stripped before storage

    expect((await review(analyst, t.id, "approve")).status).toBe(403); // analysts can't review
    const self = await upload(adminA, file("front_other_label_design.jpg"), label({ variant: "special" }));
    const selfT = await self.json();
    const own = await review(adminA, selfT.id, "approve");
    expect(own.status).toBe(403);
    expect((await own.json()).error).toBe("two_person_rule");
    // …and the database refuses it even if application code were bypassed.
    await expect(q(`update verified_templates set status='active', reviewed_by=created_by, reviewed_at=now() where id=$1`, [selfT.id])).rejects.toThrow(/two_person/);
  });

  it("unusable photos are refused before review; exact duplicates are refused", async () => {
    const notUv = await upload(analyst, file("front_genuine.jpg"), { ...label(), kind: "uv" });
    expect(notUv.status).toBe(422);
    expect((await notUv.json()).message).toMatch(/blacklight/);
    const blurry = await upload(analyst, file("front_blurry.jpg"), label());
    expect(blurry.status).toBe(422);
    const dupe = await upload(analyst, file("reference_labeled.jpg"), label());
    expect(dupe.status).toBe(409);
  });

  it("a pending template isn't used; once approved by a second person it is; history is recorded", async () => {
    expect((await analyzeTag("front_label_swap.jpg"))("holder.label_layout").status).toBe("inconclusive"); // pending only
    expect((await review(adminA, regularId, "approve")).status).toBe(200);
    const o = await analyzeTag("front_label_swap.jpg"); // same label design, different text
    expect(o("holder.label_colour").status).toBe("consistent");
    const d = await (await detailGET(req(`/api/admin/templates/${regularId}`, adminB, { aal2: true }), ctx(regularId))).json();
    expect(d.history.map((h: any) => h.action)).toEqual(["template.submit", "template.approve"]);
    expect(d.template.reviewed_by_email).toBeTruthy();
  });

  it("new submissions are compared with approved templates; the best-matching variant is used", async () => {
    const pending = (await (await listGET(req("/api/admin/templates?status=pending", adminB, { aal2: true }))).json()).templates;
    const special = pending.find((t: any) => t.variant === "special");
    // Submitted before "regular" was approved, so it had nothing to compare with; a fresh one would differ.
    expect(special.consistency.verdict).toBe("first");
    const before = await analyzeTag("front_other_label_design.jpg");
    expect(before("holder.label_colour").status).toBe("potential_discrepancy"); // only "regular" approved
    expect((await review(adminB, special.id, "approve", "Special label confirmed with the grader")).status).toBe(200);
    const after = await analyzeTag("front_other_label_design.jpg");
    expect(after("holder.label_colour").status).toBe("consistent"); // matched the "special" variant
    const again = await analyzeTag("front_label_swap.jpg");
    expect(again("holder.label_colour").status).toBe("consistent"); // still matches "regular"
  });

  it("retiring needs a reason and takes effect immediately; the release fingerprint changes", async () => {
    const fp1 = (await currentComponents()).templates;
    expect(fp1.active).toBe(2);
    expect((await retirePOST(req(`/api/admin/templates/${regularId}/retire`, adminB, { method: "POST", aal2: true, json: { reason: "" } }), ctx(regularId))).status).toBe(400);
    expect((await retirePOST(req(`/api/admin/templates/${regularId}/retire`, adminB, { method: "POST", aal2: true, json: { reason: "Superseded by a sharper photo" } }), ctx(regularId))).status).toBe(200);
    const fp2 = (await currentComponents()).templates;
    expect(fp2.active).toBe(1);
    expect(fp2.sha256).not.toBe(fp1.sha256);
    const o = await analyzeTag("front_label_swap.jpg");
    expect(o("holder.label_colour").status).not.toBe("consistent"); // "regular" no longer used; only "special" remains
    const cov = (await (await listGET(req("/api/admin/templates", adminB, { aal2: true }))).json()).coverage.find((c: any) => c.generationId === "tag_current");
    expect(cov.kinds.label).toEqual({ active: 1, pending: 0 });
  });

  it("rejection needs a reason", async () => {
    const r = await (await upload(analyst, file("front_genuine.jpg"), label({ variant: "maybe" }))).json();
    expect(r.consistency.compared).toBe(1); // compared with the one approved template ("special")
    expect(r.consistency.results[0].variant).toBe("special");
    expect((await review(adminA, r.id, "reject", "")).status).toBe(400);
    expect((await review(adminA, r.id, "reject", "Wrong generation — this is the older label")).status).toBe(200);
    expect((await review(adminB, r.id, "approve")).status).toBe(409); // already decided
  });
});
