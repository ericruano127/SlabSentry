import { q } from "./db";
import { storage } from "./storage";

/**
 * Retention policy (configurable; defaults documented in legal/privacy.md):
 *  - original + derived media: deleted RETENTION_MEDIA_DAYS (365) after upload; the database row is kept
 *    (role, quality, hashes) so reports stay intact, with storage_key cleared and purged_at set;
 *  - reports: kept until the user deletes them or the account;
 *  - operational data: rate-limit counters 2 days, finished jobs 30 days.
 */
export const RETENTION_MEDIA_DAYS = Number(process.env.RETENTION_MEDIA_DAYS ?? 365);

export async function runRetention(now = new Date(), log: (m: string) => void = () => {}) {
  const expired = await q(
    `select i.id, i.storage_key from submitted_images i join verification_sessions s on s.id=i.session_id
      where i.purged_at is null and i.storage_key is not null and s.status not in ('queued','processing')
        and i.created_at < $1::timestamptz - make_interval(days => $2) limit 5000`,
    [now.toISOString(), RETENTION_MEDIA_DAYS],
  );
  let purged = 0;
  for (const img of expired) {
    try {
      await storage.remove(img.storage_key);
      await q(`update submitted_images set storage_key=null, purged_at=$2 where id=$1`, [img.id, now.toISOString()]);
      purged++;
    } catch (e) {
      log(`retention: could not delete ${img.id}: ${(e as Error).message}`);
    }
  }
  const rl = await q(`delete from rate_limits where window_start < $1::timestamptz - interval '2 days' returning 1`, [now.toISOString()]);
  const jobs = await q(`delete from jobs where status in ('done','failed') and created_at < $1::timestamptz - interval '30 days' returning 1`, [now.toISOString()]);
  log(`retention: media purged ${purged}/${expired.length}, rate-limit rows ${rl.length}, jobs ${jobs.length}`);
  return { purged, candidates: expired.length, rateLimitRows: rl.length, jobs: jobs.length };
}
