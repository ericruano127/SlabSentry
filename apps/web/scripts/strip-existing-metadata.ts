/**
 * One-off backfill: strip identifying metadata from images stored before the sanitizer existed.
 * Idempotent (only rows with metadata_signals IS NULL are processed). Run: pnpm --filter @slabguard/web exec tsx scripts/strip-existing-metadata.ts
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, q } from "../lib/db";
import { sanitize } from "../lib/metadata";
import { storage } from "../lib/storage";

export async function stripExisting(log = console.log) {
  const rows = await q(`select id, storage_key, mime from submitted_images where metadata_signals is null and storage_key is not null and purged_at is null and is_original order by created_at`);
  let changed = 0, failed = 0;
  for (const r of rows) {
    try {
      const before = await storage.get(r.storage_key);
      const { data, signals } = sanitize(before, r.mime);
      if (!data.equals(before)) {
        await storage.put(r.storage_key, data, r.mime, { overwrite: true });
        changed++;
      }
      await q(`update submitted_images set metadata_signals=$2, bytes=$3, sha256=$4 where id=$1`, [r.id, JSON.stringify({ ...signals, backfilled: true }), data.length, createHash("sha256").update(data).digest("hex")]);
    } catch (e) {
      failed++;
      log(`could not sanitize ${r.id}: ${(e as Error).message}`);
    }
  }
  log(`metadata backfill: ${rows.length} checked, ${changed} rewritten, ${failed} failed`);
  return { checked: rows.length, changed, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  stripExisting().then(() => pool.end());
}
