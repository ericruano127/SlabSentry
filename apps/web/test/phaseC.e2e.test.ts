/** Phase C end-to-end (live vision): live-capture attestation, cloned-cert sightings across users,
 * verified label templates, UV capture, image-integrity signals, market value + price anomaly. */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { reserveCredit } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { addImage } from "../lib/sessions";
import { POST as noncePOST } from "../app/api/sessions/[id]/capture-nonce/route";
import { POST as compsPOST } from "../app/api/sessions/[id]/comps/route";
import { GET as marketGET } from "../app/api/sessions/[id]/market/route";
import { POST as templatesPOST } from "../app/api/admin/templates/route";
import { POST as reviewPOST } from "../app/api/admin/templates/[id]/review/route";
import { withMetadata } from "./exif-fixture";
import { newSession, newUser, req, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const run = (await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false)) && existsSync(`${FIX}/uv_label.jpg`);
const file = (n: string) => readFileSync(`${FIX}/${n}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function session(u: string, o: { grader?: string; cert?: string; category?: string; mode?: string } = {}) {
  const s = await newSession(u, o.mode ?? "in_hand");
  await q(`update verification_sessions set grader=$2, cert_number=$3, cert_source='user', cert_confirmed=true, category=$4 where id=$1`, [s, o.grader ?? "PSA", o.cert ?? "12345678", o.category ?? "tcg"]);
  return s;
}
async function analyze(u: string, s: string) {
  await reserveCredit(u, s);
  await enqueueAnalysis(s, 0);
  await drainJobs();
  const r = (await q(`select report from verification_reports where session_id=$1 order by analysis_run desc limit 1`, [s]))[0]?.report;
  if (!r) throw new Error((await q(`select error from verification_sessions where id=$1`, [s]))[0].error);
  return r;
}
const obs = (rep: any, id: string) => rep.engine.observations.find((o: any) => o.id === id);

beforeAll(async () => { if (run) await resetDb(); });
afterAll(() => pool.end());

describe.skipIf(!run)("phase C pipeline (live vision service)", () => {

  it("live in-app capture is attested by a single-use code", async () => {
    const u = await newUser();
    const s = await session(u);
    const { nonce } = await (await noncePOST(req(`/api/sessions/${s}/capture-nonce`, u, { method: "POST" }), ctx(s))).json();
    const img = await addImage(u, s, "front", file("front_genuine.jpg"), { captureNonce: nonce });
    const reused = await addImage(u, s, "back", file("front_genuine.jpg"), { captureNonce: nonce });
    const prov = await q(`select id, provenance from submitted_images where id = any($1)`, [[img.id, reused.id]]);
    expect(prov.find((p) => p.id === img.id).provenance.capture).toBe("live");
    expect(prov.find((p) => p.id === reused.id).provenance.capture).toBeUndefined(); // single use
    const rep = await analyze(u, s);
    expect(obs(rep, "capture.live")?.status).toBe("consistent");
  });

  it("the same cert on a visually different item in another user's upload is flagged, without exposing that user", async () => {
    const a = await newUser(), b = await newUser(), c = await newUser();
    const sa = await session(a, { cert: "55500011" });
    await addImage(a, sa, "front", file("front_genuine.jpg"));
    const ra = await analyze(a, sa);
    expect(obs(ra, "cert.sightings")).toBeUndefined(); // first sighting
    const sb = await session(b, { cert: "55500011" });
    await addImage(b, sb, "front", file("front_different_card.jpg"));
    const rb = await analyze(b, sb);
    expect(obs(rb, "cert.sightings").status).toBe("potential_discrepancy");
    expect(rb.engine.findings.find((f: any) => f.id === "f.cert_clone_sightings")).toBeTruthy();
    expect(JSON.stringify(rb)).not.toContain(a); // no other-user ids leak
    const sc = await session(c, { cert: "55500011" });
    await addImage(c, sc, "front", file("front_genuine.jpg")); // same item photographed again
    const rc = await analyze(c, sc);
    expect(obs(rc, "cert.sightings").metrics.visuallyDifferent).toBe(1); // only b's different item, not a's
    const raw = await q(`select cert_key, user_key from cert_sightings limit 1`);
    expect(raw[0].cert_key).not.toContain("55500011");
    expect(raw[0].cert_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verified label templates: same design is consistent, a different label design is flagged", async () => {
    const staff = await newUser();
    await q(`update app_users set role='admin' where id=$1`, [staff]);
    const src = await session(staff, { grader: "TAG", cert: "T1000001" });
    const srcImg = await addImage(staff, src, "front", file("reference_labeled.jpg"));
    const denied = await templatesPOST(req("/api/admin/templates", staff, { method: "POST", json: { imageId: srcImg.id, generationId: "tag_current", kind: "label", note: "Confirmed with grader" } }));
    expect(denied.status).toBe(403); // no 2FA
    const ok = await templatesPOST(req("/api/admin/templates", staff, { method: "POST", aal2: true, json: { imageId: srcImg.id, generationId: "tag_current", kind: "label", note: "Slab confirmed genuine by the grader (test)" } }));
    expect(ok.status).toBe(201);
    const reviewer = await newUser(); // two-person rule: a second admin approves
    await q(`update app_users set role='admin' where id=$1`, [reviewer]);
    const tpl = await ok.json();
    expect((await reviewPOST(req(`/api/admin/templates/${tpl.id}/review`, reviewer, { method: "POST", aal2: true, json: { decision: "approve", note: "checked" } }), ctx(tpl.id))).status).toBe(200);

    const u = await newUser();
    const same = await session(u, { grader: "TAG", cert: "T1000002" });
    await addImage(u, same, "front", file("front_label_swap.jpg")); // same label design, different text
    const r1 = await analyze(u, same);
    expect(r1.engine.era.generation.id).toBe("tag_current");
    expect(obs(r1, "holder.label_colour").status).toBe("consistent");
    const diff = await session(u, { grader: "TAG", cert: "T1000003" });
    await addImage(u, diff, "front", file("front_other_label_design.jpg"));
    const r2 = await analyze(u, diff);
    expect(obs(r2, "holder.label_colour").status).toBe("potential_discrepancy");
    expect(r2.engine.findings.some((f: any) => f.id === "f.label_template")).toBe(true);
  });

  it("UV photo without a verified template stays inconclusive; image-editing signals surface as review items", async () => {
    const u = await newUser();
    const s = await session(u, { grader: "CGC", cert: "4012345001" });
    await addImage(u, s, "front", withMetadata(file("front_genuine.jpg"), 1));
    await addImage(u, s, "uv", file("uv_label.jpg"));
    const rep = await analyze(u, s);
    expect(obs(rep, "sec.cgc_uv_ink").status).toBe("inconclusive");
    const ev = rep.engine.observations.find((o: any) => o.id.endsWith(".software"));
    expect(ev.status).toBe("inconclusive");
    expect(ev.detail).toContain("Adobe Photoshop");
  });

  it("market value from comps (assumes genuine) and a too-good-to-be-true listing price", async () => {
    const u = await newUser();
    const s = await session(u, { mode: "online_listing" });
    await q(`update verification_sessions set grade_label='PSA 10', asking_price_cents=20000 where id=$1`, [s]);
    const today = new Date();
    for (const [p, d] of [[100000, 3], [104000, 9], [98000, 15], [101000, 30]] as const)
      await compsPOST(req(`/api/sessions/${s}/comps`, u, { method: "POST", json: { priceCents: p, soldAt: new Date(today.getTime() - d * 864e5).toISOString().slice(0, 10), gradeLabel: "PSA 10" } }), ctx(s));
    const live = await (await marketGET(req(`/api/sessions/${s}/market`, u), ctx(s))).json();
    expect(live.value.status).toBe("estimated");
    expect(live.value.estimateCents).toBe(100500);
    expect(live.value.note).toMatch(/genuine/);
    expect(live.providers[0].connected).toBe(false); // no provider without verified mapping
    await addImage(u, s, "front", file("front_genuine.jpg"));
    const rep = await analyze(u, s);
    expect(rep.market.estimateCents).toBe(100500);
    expect(rep.engine.findings.find((f: any) => f.pattern === "price_anomaly")?.severity).toBe("low");
  });
});

describe.skipIf(!run)("phase D gate", () => {
  it("front and back are both required before any credit is reserved", async () => {
    const { preflight, activeImages } = await import("../lib/sessions");
    const u = await newUser();
    const s = await session(u);
    await addImage(u, s, "front", file("front_genuine.jpg"));
    expect(preflight(await activeImages(s)).map((p) => p.role)).toEqual(["back"]);
    await addImage(u, s, "back", file("front_different_card.jpg"));
    expect(preflight(await activeImages(s))).toEqual([]);
    const rep = await analyze(u, s);
    expect(rep.quickSummary.headline).toBeTruthy();
    expect(rep.imageQuality.map((r: any) => r.role).sort()).toEqual(["back", "front"]);
  });
});
