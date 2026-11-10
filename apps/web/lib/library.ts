import { createHash } from "node:crypto";
import { canonicalJson, compileLibrary, DEFAULT_LIBRARY, LibrarySchema, type CompiledLibrary } from "@slabguard/core";
import { one, q, tx } from "./db";
import { HttpError } from "./http";

/**
 * Server access to the reference library. Analysis always uses the single PUBLISHED release, whose
 * content hash is re-verified on load (tamper detection). Drafts are editable; published/retired
 * releases are immutable (enforced by a database trigger). Every change is audited.
 */
export const sha256 = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");

let cache: { at: number; lib: CompiledLibrary } | null = null;
const TTL = 60_000;
export function invalidateLibrary() { cache = null; }

export async function loadLibrary(): Promise<CompiledLibrary> {
  if (cache && Date.now() - cache.at < TTL) return cache.lib;
  const r = await one(`select id, version, content, content_sha256 from library_releases where status='published'`);
  if (!r) throw new HttpError(503, "library_unavailable", "Reference library is not published yet.");
  if (sha256(r.content) !== r.content_sha256) {
    console.error(`SECURITY: library release ${r.version} failed its integrity check`);
    throw new HttpError(503, "library_integrity", "Reference library integrity check failed. Analysis is paused until it is restored.");
  }
  const lib = compileLibrary(r.content, { version: r.version, sha256: r.content_sha256 });
  cache = { at: Date.now(), lib };
  return lib;
}

/** Seed the first release from the built-in library (fresh installs only). */
export async function seedLibrary(version = "2026.11.1") {
  const existing = await one(`select count(*)::int n from library_releases`);
  if (existing.n > 0) return false;
  const content = LibrarySchema.parse(DEFAULT_LIBRARY);
  await q(`insert into library_releases (version,status,content,content_sha256,notes,published_at) values ($1,'published',$2,$3,'Initial release seeded from built-in library',now())`,
    [version, JSON.stringify(content), sha256(content)]);
  return true;
}

export async function listReleases() {
  return q(`select id, version, status, content_sha256, notes, based_on, created_by, created_at, published_by, published_at from library_releases order by id desc`);
}

export async function getRelease(id: number) {
  const r = await one(`select * from library_releases where id=$1`, [id]);
  if (!r) throw new HttpError(404, "not_found", "Release not found");
  return r;
}

const audit = (c: any, actor: string, action: string, before: unknown, after: unknown) =>
  c.query(`insert into admin_audit_log (admin_id,action,before,after) values ($1,$2,$3,$4)`, [actor, action, JSON.stringify(before ?? null), JSON.stringify(after ?? null)]);

export async function createDraft(actor: string, version: string, basedOn?: number) {
  return tx(async (c) => {
    const base = basedOn
      ? (await c.query(`select id, content from library_releases where id=$1`, [basedOn])).rows[0]
      : (await c.query(`select id, content from library_releases where status='published'`)).rows[0];
    if (!base) throw new HttpError(404, "not_found", "No release to base the draft on.");
    const dup = (await c.query(`select 1 from library_releases where version=$1`, [version])).rowCount;
    if (dup) throw new HttpError(409, "version_exists", `Version ${version} already exists.`);
    const r = (await c.query(`insert into library_releases (version,status,content,based_on,created_by) values ($1,'draft',$2,$3,$4) returning id, version`, [version, JSON.stringify(base.content), base.id, actor])).rows[0];
    await audit(c, actor, "library.draft_create", { basedOn: base.id }, r);
    return r;
  });
}

export async function updateDraft(actor: string, id: number, content: unknown, notes?: string) {
  const parsed = LibrarySchema.safeParse(content);
  if (!parsed.success) throw new HttpError(400, "invalid_library", "The library has validation errors.", { issues: parsed.error.issues.slice(0, 50) });
  return tx(async (c) => {
    const r = (await c.query(`select status, content from library_releases where id=$1 for update`, [id])).rows[0];
    if (!r) throw new HttpError(404, "not_found", "Release not found");
    if (r.status !== "draft") throw new HttpError(409, "immutable", "Only drafts can be edited.");
    await c.query(`update library_releases set content=$2, notes=coalesce($3,notes) where id=$1`, [id, JSON.stringify(parsed.data), notes ?? null]);
    await audit(c, actor, "library.draft_update", { id, sha256: sha256(r.content) }, { id, sha256: sha256(parsed.data) });
    return { id, sha256: sha256(parsed.data) };
  });
}

/** Publish a draft (or re-publish a retired release = rollback). Previous published release is retired. */
export async function publishRelease(actor: string, id: number, reason: string) {
  const out = await tx(async (c) => {
    const r = (await c.query(`select * from library_releases where id=$1 for update`, [id])).rows[0];
    if (!r) throw new HttpError(404, "not_found", "Release not found");
    if (r.status === "published") throw new HttpError(409, "already_published", "Already published.");
    const parsed = LibrarySchema.safeParse(r.content);
    if (!parsed.success) throw new HttpError(400, "invalid_library", "The library has validation errors.", { issues: parsed.error.issues.slice(0, 50) });
    const hash = sha256(r.content);
    if (r.status === "retired" && r.content_sha256 !== hash) throw new HttpError(409, "integrity", "Retired release failed its integrity check.");
    const prev = (await c.query(`update library_releases set status='retired' where status='published' returning id, version`)).rows[0];
    await c.query(`update library_releases set status='published', content_sha256=$2, published_by=$3, published_at=now() where id=$1`, [id, hash, actor]);
    await audit(c, actor, r.status === "retired" ? "library.rollback" : "library.publish", prev ?? null, { id, version: r.version, sha256: hash, reason });
    return { id, version: r.version, sha256: hash, retired: prev ?? null };
  });
  invalidateLibrary();
  return out;
}

/** Public, non-sensitive view: categories (names, status, capture guidance) and graders (names, lookup links). */
export function publicLibraryView(lib: CompiledLibrary) {
  return {
    version: lib.meta.version,
    categories: lib.data.categories.map((c) => ({ id: c.id, name: c.name, description: c.description, launchStatus: c.launchStatus, subcategories: c.subcategories, captureGuidance: c.captureGuidance })),
    graders: lib.data.graders.map((g) => ({ id: g.id, name: g.name, categories: g.categories, lookupBaseUrl: g.lookupBaseUrl, status: g.status })),
  };
}
