/** Phase A: consent gate, training consent snapshots, metadata stripping on upload, data export,
 * retention, RBAC + MFA, metadata backfill, production startup guard, upload hardening. */
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, q } from "../lib/db";
import { invalidateLegalCache } from "../lib/consent";
import { runRetention } from "../lib/retention";
import { addImage } from "../lib/sessions";
import { storage } from "../lib/storage";
import { assertProductionReady, isLocalDbHost } from "../lib/startup";
import { stripExisting } from "../scripts/strip-existing-metadata";
import { GET as sessionsGET } from "../app/api/sessions/route";
import { GET as meGET } from "../app/api/me/route";
import { POST as consentPOST, PATCH as consentPATCH } from "../app/api/consent/route";
import { GET as exportGET } from "../app/api/account/export/route";
import { GET as imageGET } from "../app/api/images/[id]/route";
import { GET as metricsGET } from "../app/api/admin/metrics/route";
import { PUT as plansPUT } from "../app/api/admin/plans/route";
import { PUT as rolePUT } from "../app/api/admin/users/role/route";
import { withMetadata } from "./exif-fixture";
import { newSession, newUser, req, resetDb } from "./helpers";

const FIX = process.env.FIXTURES_DIR ?? "/tmp/claude-0/fixtures";
const vision = await fetch(`${process.env.VISION_URL}/health`).then((r) => r.ok, () => false);
const jpeg = () => readFileSync(`${FIX}/front_genuine.jpg`);

beforeAll(resetDb);
afterAll(() => pool.end());

describe("consent", () => {
  it("blocks the service until current Terms + Privacy are accepted, and logs the acceptance", async () => {
    const u = await newUser(false);
    const blocked = await sessionsGET(req("/api/sessions", u));
    expect(blocked.status).toBe(428);
    const me = await (await meGET(req("/api/me", u))).json();
    expect(me.consent.required).toBe(true);
    expect(me.consent.pendingLegalReview).toBe(true);
    const stale = await consentPOST(req("/api/consent", u, { method: "POST", json: { terms: "old", privacy: me.consent.privacy.current } }));
    expect(stale.status).toBe(409);
    const ok = await consentPOST(req("/api/consent", u, { method: "POST", json: { terms: me.consent.terms.current, privacy: me.consent.privacy.current } }));
    expect((await ok.json()).required).toBe(false);
    expect((await sessionsGET(req("/api/sessions", u))).status).toBe(200);
    const ev = await q(`select kind, action, version from consent_events where user_id=$1 order by id`, [u]);
    expect(ev.map((e) => `${e.kind}:${e.action}`)).toEqual(["terms:accepted", "privacy:accepted"]);
    expect((await q(`select training_consent from app_users where id=$1`, [u]))[0].training_consent).toBe(false); // never defaulted on
  });

  it("consent history is append-only", async () => {
    const u = await newUser();
    await q(`update consent_events set version='tampered' where user_id=$1`, [u]);
    await q(`delete from consent_events where user_id=$1`, [u]);
    const ev = await q(`select version from consent_events where user_id=$1`, [u]);
    expect(ev.length).toBe(2);
    expect(ev.every((e) => e.version !== "tampered")).toBe(true);
  });

  it("publishing a new Terms version requires re-acceptance", async () => {
    const u = await newUser();
    await q(`insert into legal_documents (kind,version,title,body_md,published) values ('terms','2099-test','Terms','new terms',true)`);
    await q(`update legal_documents set effective_at = now() + interval '1 second' where kind='terms' and version='2099-test'`);
    await new Promise((r) => setTimeout(r, 1100));
    invalidateLegalCache();
    expect((await sessionsGET(req("/api/sessions", u))).status).toBe(428);
    await q(`delete from legal_documents where version='2099-test'`);
    invalidateLegalCache();
  });

  it.skipIf(!vision)("training consent is opt-in, snapshotted per upload, and revocable", async () => {
    const u = await newUser();
    const s = await newSession(u);
    const before = await addImage(u, s, "front", jpeg());
    await consentPATCH(req("/api/consent", u, { method: "PATCH", json: { training: true } }));
    const after = await addImage(u, s, "back", jpeg());
    const snap = await q(`select id, training_consent, consent_version from submitted_images where id = any($1) order by created_at`, [[before.id, after.id]]);
    expect(snap.map((r) => r.training_consent)).toEqual([false, true]);
    expect(snap[1].consent_version).toBe("2026-11-draft-1");
    expect((await q(`select id from training_eligible_images where user_id=$1`, [u])).map((r) => r.id)).toEqual([after.id]);
    await consentPATCH(req("/api/consent", u, { method: "PATCH", json: { training: false } }));
    expect(await q(`select id from training_eligible_images where user_id=$1`, [u])).toHaveLength(0);
    const pr = await q(`select kind from privacy_requests where user_id=$1 order by created_at`, [u]);
    expect(pr.map((r) => r.kind)).toEqual(["opt_in_training", "opt_out_training"]);
  });
});

describe.skipIf(!vision)("uploads", () => {
  it("strips GPS/EXIF before storage and records only non-identifying signals", async () => {
    const u = await newUser();
    const s = await newSession(u);
    const img = await addImage(u, s, "front", withMetadata(jpeg(), 1));
    const row = (await q(`select storage_key, metadata_signals, sha256, bytes from submitted_images where id=$1`, [img.id]))[0];
    const stored = (await storage.get(row.storage_key)).toString("latin1");
    for (const leak of ["Canon", "SN-0042424242", "GPS", "jane", "hidden zip"]) expect(stored).not.toContain(leak);
    expect(row.metadata_signals).toMatchObject({ hadGps: true, editorDetected: true, software: "Adobe Photoshop 25.0" });
    expect(JSON.stringify(row.metadata_signals)).not.toMatch(/40\/1|SN-00|Canon/);
  });

  it("rejects truncated files and decompression bombs before analysis", async () => {
    const u = await newUser();
    const s = await newSession(u);
    const b = jpeg();
    await expect(addImage(u, s, "front", b.subarray(0, b.length - 500))).rejects.toMatchObject({ status: 422 });
    const bomb = Buffer.from(b);
    const sof = bomb.indexOf(Buffer.from([0xff, 0xc0]));
    bomb.writeUInt16BE(65000, sof + 5); bomb.writeUInt16BE(65000, sof + 7);
    await expect(addImage(u, s, "front", bomb)).rejects.toMatchObject({ status: 413, code: "too_many_pixels" });
  });
});

describe.skipIf(!vision)("privacy rights", () => {
  it("exports all user data (including photos) as a zip, even before consent, and logs the request", async () => {
    const u = await newUser();
    const s = await newSession(u);
    await addImage(u, s, "front", jpeg());
    await q(`update app_users set terms_version=null where id=$1`, [u]); // simulate pending re-consent
    const res = await exportGET(req("/api/account/export", u));
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const data = JSON.parse(strFromU8(files["data.json"]));
    expect(data.account.id).toBe(u);
    expect(data.sessions).toHaveLength(1);
    expect(data.consentHistory.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(files).some((f) => f.startsWith("photos/") && f.endsWith(".jpeg"))).toBe(true);
    expect(JSON.stringify(data)).not.toContain("storage_key");
    expect((await q(`select kind from privacy_requests where user_id=$1`, [u])).map((r) => r.kind)).toContain("access");
  });

  it("retention purges old media but keeps the report record", async () => {
    const u = await newUser();
    const s = await newSession(u);
    const img = await addImage(u, s, "front", jpeg());
    const key = (await q(`select storage_key from submitted_images where id=$1`, [img.id]))[0].storage_key;
    await q(`update submitted_images set created_at = now() - interval '400 days' where id=$1`, [img.id]);
    const r = await runRetention();
    expect(r.purged).toBeGreaterThanOrEqual(1);
    await expect(storage.get(key)).rejects.toThrow();
    const row = (await q(`select storage_key, purged_at, quality from submitted_images where id=$1`, [img.id]))[0];
    expect(row.storage_key).toBeNull();
    expect(row.purged_at).not.toBeNull();
    expect(row.quality).not.toBeNull(); // analysis record kept
    expect((await imageGET(req(`/api/images/${img.id}`, u), { params: Promise.resolve({ id: img.id }) })).status).toBe(410);
  });

  it("backfill strips metadata from images stored before the sanitizer existed", async () => {
    const u = await newUser();
    const s = await newSession(u);
    const key = `${u}/${s}/legacy.jpeg`;
    await storage.put(key, withMetadata(jpeg(), 1), "image/jpeg");
    await q(`insert into submitted_images (session_id,user_id,role,storage_key,mime,bytes,sha256,provenance) values ($1,$2,'front',$3,'image/jpeg',1,'x','{}')`, [s, u, key]);
    const r = await stripExisting(() => {});
    expect(r.changed).toBeGreaterThanOrEqual(1);
    expect((await storage.get(key)).toString("latin1")).not.toMatch(/Canon|GPS|SN-00/);
  });
});

describe("staff access (RBAC + MFA)", () => {
  it("least privilege and mandatory 2FA for staff tools", async () => {
    const user = await newUser(), analyst = await newUser(), owner = await newUser();
    await q(`update app_users set role='analyst' where id=$1`, [analyst]);
    await q(`update app_users set role='owner' where id=$1`, [owner]);
    expect((await metricsGET(req("/api/admin/metrics", user, { aal2: true }))).status).toBe(403);
    const noMfa = await metricsGET(req("/api/admin/metrics", analyst));
    expect([noMfa.status, (await noMfa.json()).error]).toEqual([403, "mfa_required"]);
    expect((await metricsGET(req("/api/admin/metrics", analyst, { aal2: true }))).status).toBe(200);
    expect((await plansPUT(req("/api/admin/plans", analyst, { method: "PUT", aal2: true, json: { plans: [], reason: "x" } }))).status).toBe(403);
    const email = (await q(`select email from app_users where id=$1`, [user]))[0].email;
    expect((await rolePUT(req("/api/admin/users/role", owner, { method: "PUT", aal2: true, json: { email, role: "support", reason: "new hire" } }))).status).toBe(200);
    expect((await q(`select role from app_users where id=$1`, [user]))[0].role).toBe("support");
    const ownEmail = (await q(`select email from app_users where id=$1`, [owner]))[0].email;
    expect((await rolePUT(req("/api/admin/users/role", owner, { method: "PUT", aal2: true, json: { email: ownEmail, role: "user", reason: "oops" } }))).status).toBe(409);
    expect((await q(`select count(*)::int n from admin_audit_log where action='role.update'`))[0].n).toBe(1);
  });
});

describe("production startup guard", () => {
  it("refuses insecure configuration and unreviewed legal text", async () => {
    const problems = await assertProductionReady({ NODE_ENV: "production", AUTH_MODE: "dev", DATABASE_URL: "postgres://db.example.com/x" } as any);
    const all = problems.join(" | ");
    for (const p of ["AUTH_MODE=dev", "Supabase", "VISION_API_KEY", "sslmode=require", "pending legal review"]) expect(all).toContain(p);
    expect(await assertProductionReady({ NODE_ENV: "development" } as any)).toEqual([]);
    // TLS is required over real networks; same-machine and Docker Compose service hosts are local.
    for (const [url, local] of [["postgres://postgres@postgres:5432/slabguard", true], ["postgres://u@localhost/x", true], ["postgres://u@127.0.0.1:5432/x", true],
      ["postgres://u@[::1]/x", true], ["postgres://u@db.example.com/x", false], ["postgres://u:localhost@db.example.com/x", false], ["postgres://u@10.0.0.5/x", false], ["not a url", false]] as const)
      expect(isLocalDbHost(url), url).toBe(local);
  });
});
