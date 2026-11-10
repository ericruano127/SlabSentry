/** Phase B: data-driven reference library (versioned, hashed, immutable when published, audited),
 * categories on sessions, era + library recorded in reports. */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { invalidateLibrary, loadLibrary } from "../lib/library";
import { reserveCredit } from "../lib/credits";
import { drainJobs, enqueueAnalysis } from "../lib/jobs";
import { addImage } from "../lib/sessions";
import { GET as libGET, POST as libPOST } from "../app/api/admin/library/route";
import { PUT as draftPUT } from "../app/api/admin/library/[id]/route";
import { POST as publishPOST } from "../app/api/admin/library/[id]/publish/route";
import { GET as publicLibGET } from "../app/api/library/route";
import { POST as sessionsPOST } from "../app/api/sessions/route";
import { PATCH as sessionPATCH } from "../app/api/sessions/[id]/route";
import { newSession, newUser, req, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const vision = (await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false)) && existsSync(`${FIX}/reference.jpg`);
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(resetDb);
afterAll(() => pool.end());

async function staff(role: string) {
  const u = await newUser();
  await q(`update app_users set role=$2 where id=$1`, [u, role]);
  return u;
}

describe("reference library releases", () => {
  it("seeds one published release whose hash verifies", async () => {
    invalidateLibrary();
    const lib = await loadLibrary();
    expect(lib.meta.version).toBe("2026.11.1");
    expect(lib.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lib.data.categories.length).toBe(6);
  });

  it("published content is immutable and undeletable (database trigger)", async () => {
    await expect(q(`update library_releases set content = '{}' where status='published'`)).rejects.toThrow(/immutable/);
    await expect(q(`update library_releases set content_sha256 = 'x' where status='published'`)).rejects.toThrow(/immutable/);
    await expect(q(`delete from library_releases where status='published'`)).rejects.toThrow(/cannot be deleted/);
  });

  it("tampering that bypasses the trigger is caught by the integrity check and pauses analysis", async () => {
    await q(`alter table library_releases disable trigger library_release_guard`);
    const orig = (await q(`select content from library_releases where status='published'`))[0].content;
    await q(`update library_releases set content = jsonb_set(content, '{graders,0,name}', '"Evil"') where status='published'`);
    invalidateLibrary();
    await expect(loadLibrary()).rejects.toMatchObject({ code: "library_integrity" });
    await q(`update library_releases set content = $1 where status='published'`, [JSON.stringify(orig)]);
    await q(`alter table library_releases enable trigger library_release_guard`);
    invalidateLibrary();
    expect((await loadLibrary()).data.graders[0].name).not.toBe("Evil");
  });

  it("draft → validate → publish → rollback, with least privilege and audit", async () => {
    const analyst = await staff("analyst"), admin = await staff("admin");
    expect((await libGET(req("/api/admin/library", analyst, { aal2: true }))).status).toBe(200);
    expect((await libPOST(req("/api/admin/library", analyst, { method: "POST", aal2: true, json: { version: "2026.11.2" } }))).status).toBe(403);
    expect((await libPOST(req("/api/admin/library", admin, { method: "POST", json: { version: "2026.11.2" } }))).status).toBe(403); // no 2FA
    const draft = await (await libPOST(req("/api/admin/library", admin, { method: "POST", aal2: true, json: { version: "2026.11.2" } }))).json();
    const content = (await q(`select content from library_releases where id=$1`, [draft.id]))[0].content;

    // invalid edit rejected with specific issues
    const broken = structuredClone(content);
    broken.generations[0].features.push("does_not_exist");
    const bad = await draftPUT(req(`/api/admin/library/${draft.id}`, admin, { method: "PUT", aal2: true, json: { content: broken } }), ctx(draft.id));
    expect(bad.status).toBe(400);
    expect(JSON.stringify((await bad.json()).issues)).toContain("unknown feature does_not_exist");

    // valid edit: a new grader for a new category, no code change
    content.graders.push({ ...content.graders[0], id: "NEWCO", name: "NewCo Grading", categories: ["figures"], labelTokens: ["NEWCO"], qrDomains: ["newco.example"], lookupBaseUrl: null, lookupUrlTemplate: null });
    expect((await draftPUT(req(`/api/admin/library/${draft.id}`, admin, { method: "PUT", aal2: true, json: { content } }), ctx(draft.id))).status).toBe(200);
    const pub = await publishPOST(req(`/api/admin/library/${draft.id}/publish`, admin, { method: "POST", aal2: true, json: { reason: "Add NewCo figures grader" } }), ctx(draft.id));
    expect(pub.status).toBe(200);
    expect((await loadLibrary()).meta.version).toBe("2026.11.2");
    const publicView = await (await publicLibGET()).json();
    expect(publicView.graders.map((g: any) => g.id)).toContain("NEWCO");
    expect(JSON.stringify(publicView)).not.toMatch(/visualMarkers|exclusive|certRanges|officialLabelTypes/); // detection details stay private

    // rollback to the retired original
    const first = (await q(`select id from library_releases where version='2026.11.1'`))[0].id;
    expect((await publishPOST(req(`/api/admin/library/${first}/publish`, admin, { method: "POST", aal2: true, json: { reason: "Rollback test" } }), ctx(first))).status).toBe(200);
    expect((await loadLibrary()).meta.version).toBe("2026.11.1");
    expect((await q(`select status from library_releases order by id`)).map((r) => r.status)).toEqual(["published", "retired"]);
    const audit = (await q(`select action from admin_audit_log where action like 'library.%' order by id`)).map((r) => r.action);
    expect(audit).toEqual(["library.draft_create", "library.draft_update", "library.publish", "library.rollback"]);
  });
});

describe("categories on sessions", () => {
  it("validates categories and scopes graders to the category", async () => {
    const u = await newUser();
    expect((await sessionsPOST(req("/api/sessions", u, { method: "POST", json: { category: "spaceships" } }))).status).toBe(400);
    const { id } = await (await sessionsPOST(req("/api/sessions", u, { method: "POST", json: { category: "sealed_video_games" } }))).json();
    expect((await q(`select category from verification_sessions where id=$1`, [id]))[0].category).toBe("sealed_video_games");
    const psa = await sessionPATCH(req(`/api/sessions/${id}`, u, { method: "PATCH", json: { grader: "PSA" } }), ctx(id));
    expect([psa.status, (await psa.json()).error]).toEqual([400, "invalid_grader"]);
    expect((await sessionPATCH(req(`/api/sessions/${id}`, u, { method: "PATCH", json: { grader: "WATA", certNumber: "123456789" } }), ctx(id))).status).toBe(200);
  });

  it("sessions created without a category default to sports cards (legacy behaviour)", async () => {
    const u = await newUser();
    const { id } = await (await sessionsPOST(req("/api/sessions", u, { method: "POST", json: {} }))).json();
    expect((await q(`select category from verification_sessions where id=$1`, [id]))[0].category).toBe("sports_cards");
  });
});

describe.skipIf(!vision)("reports record category, era and the library release", () => {
  async function analyze(category: string, grader: string) {
    const u = await newUser();
    const s = await newSession(u);
    await q(`update verification_sessions set category=$2, grader=$3, cert_number='12345678', cert_source='user', cert_confirmed=true where id=$1`, [s, category, grader]);
    await addImage(u, s, "front", readFileSync(`${FIX}/front_other_copy.jpg`));
    await addImage(u, s, "reference_front", readFileSync(`${FIX}/reference.jpg`), { attestation: "Saved from the grader's official cert page" });
    await reserveCredit(u, s);
    await enqueueAnalysis(s, 0);
    await drainJobs();
    return (await q(`select report from verification_reports where session_id=$1`, [s]))[0].report;
  }

  it("card report: era observation present, library version + hash recorded", async () => {
    const lib = await loadLibrary();
    const rep = await analyze("tcg", "PSA");
    expect(rep.category).toBe("tcg");
    expect(rep.library).toEqual({ version: lib.meta.version, sha256: lib.meta.sha256 });
    expect(rep.engine.era.basis).toBe("unknown"); // no official data (no PSA token) and no exclusive markers
    expect(rep.engine.observations.find((o: any) => o.id === "holder.era").status).toBe("inconclusive");
    expect(rep.engine.physicalMatch[0].verdict).toBe("conflicting"); // different copy still caught
  });

  it("sealed game report: generic geometry, copy fingerprint disabled for an unvalidated category", async () => {
    const rep = await analyze("sealed_video_games", "WATA");
    expect(rep.category).toBe("sealed_video_games");
    expect(rep.engine.physicalMatch).toEqual([]);
    expect(rep.engine.findings.some((f: any) => f.pattern === "different_physical_card")).toBe(false);
    expect(rep.official.lookupUrl).toBeNull(); // WATA lookup URL not confirmed → no invented link
  });
});
