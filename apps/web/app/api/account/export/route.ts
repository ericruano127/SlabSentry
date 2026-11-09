import { zipSync, strToU8 } from "fflate";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { handle } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { storage } from "@/lib/storage";

/**
 * Right to access (CCPA/CPRA): everything we hold about the user, as a zip of JSON + their photos.
 * Works before consent acceptance. Logged in privacy_requests.
 */
export const GET = handle(async (req: Request) => {
  const u = await requireUser(req, { skipConsent: true });
  await rateLimit(`export:${u.id}`, 5, 3600);
  const one = async (sql: string) => (await q(sql, [u.id]))[0] ?? null;
  const data = {
    exportedAt: new Date().toISOString(),
    note: "Photos were stored with location and device metadata removed. Photos older than the retention period have been deleted and are listed as purged.",
    account: await one(`select id, email, role, created_at, terms_version, privacy_version, terms_accepted_at, training_consent, training_consent_version, training_consent_at from app_users where id=$1`),
    consentHistory: await q(`select kind, version, action, source, created_at from consent_events where user_id=$1 order by id`, [u.id]),
    privacyRequests: await q(`select kind, status, created_at, completed_at from privacy_requests where user_id=$1 order by created_at`, [u.id]),
    subscriptions: await q(`select plan_id, provider, status, billing_interval, started_at, current_period_end, cancel_at_period_end from user_subscriptions where user_id=$1`, [u.id]),
    payments: await q(`select provider, amount_cents, refunded_cents, currency, status, occurred_at from payments where user_id=$1`, [u.id]),
    verificationUsage: await q(`select session_id, attempt, action, reason, created_at from verification_usage_ledger where user_id=$1 order by id`, [u.id]),
    sessions: await q(`select id, mode, status, title, grader, cert_number, overall_assessment, credit_state, created_at, completed_at from verification_sessions where user_id=$1 order by created_at`, [u.id]),
    reports: await q(`select r.session_id, r.analysis_run, r.report, r.created_at from verification_reports r join verification_sessions s on s.id=r.session_id where s.user_id=$1 order by r.created_at`, [u.id]),
    images: [] as any[],
  };
  const files: Record<string, Uint8Array> = {};
  const imgs = await q(`select id, session_id, role, is_original, mime, bytes, quality, provenance, metadata_signals, training_consent, created_at, purged_at, storage_key from submitted_images where user_id=$1 order by created_at`, [u.id]);
  let total = 0;
  for (const i of imgs) {
    const { storage_key, ...meta } = i;
    let file: string | null = null;
    if (storage_key && i.is_original && total < 500 * 1024 * 1024) {
      const ext = String(i.mime).split("/")[1].replace("quicktime", "mov");
      file = `photos/${i.session_id}/${i.role}-${i.id}.${ext}`;
      const b = await storage.get(storage_key).catch(() => null);
      if (b) { files[file] = new Uint8Array(b); total += b.length; } else file = null;
    }
    data.images.push({ ...meta, file });
  }
  files["data.json"] = strToU8(JSON.stringify(data, null, 2));
  files["README.txt"] = strToU8("Your Slab Guard data export.\ndata.json: account, consents, privacy requests, subscriptions, payments, sessions and reports.\nphotos/: your original uploads that are still within the retention period.\n");
  await q(`insert into privacy_requests (user_id,kind,status,completed_at,detail) values ($1,'access','completed',now(),$2)`, [u.id, JSON.stringify({ images: Object.keys(files).length - 2 })]);
  const zip = zipSync(files, { level: 6 });
  return new Response(Buffer.from(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="slabguard-data-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "no-store" } });
});
