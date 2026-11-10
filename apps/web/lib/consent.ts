import { cachedValue } from "./cache";
import { one, q, tx, lockUser } from "./db";
import { HttpError } from "./http";

/**
 * Consent: Terms + Privacy must be accepted at the current published version before using the
 * service; training consent is a separate, optional opt-in. Every change is appended to
 * consent_events (append-only) and privacy-relevant changes to privacy_requests.
 */
export type ConsentSource = "web" | "mobile" | "api" | "system";
export interface LegalDoc { kind: string; version: string; title: string; body_md: string; requires_acceptance: boolean; legal_review_status: string; effective_at: string }

const docsCache = cachedValue(30_000, () => q<LegalDoc>(
  `select distinct on (kind) kind, version, title, body_md, requires_acceptance, legal_review_status, effective_at
     from legal_documents where published and effective_at <= now() order by kind, effective_at desc`,
), { staleWhileRevalidate: true });
export async function currentDocs(): Promise<LegalDoc[]> {
  return docsCache.get();
}
export function invalidateLegalCache() { docsCache.invalidate(); }

export interface ConsentStatus {
  required: boolean;
  terms: { current: string | null; accepted: string | null };
  privacy: { current: string | null; accepted: string | null };
  training: { granted: boolean; version: string | null; current: string | null };
  pendingLegalReview: boolean;
}

/** Pass `row` (the app_users row already loaded for this request) to skip re-reading it. */
export async function consentStatus(userId: string, row?: ConsentRow | null): Promise<ConsentStatus> {
  const docs = await currentDocs();
  const u = row ?? await one(`select terms_version, privacy_version, training_consent, training_consent_version from app_users where id=$1`, [userId]);
  const cur = (k: string) => docs.find((d) => d.kind === k)?.version ?? null;
  const terms = { current: cur("terms"), accepted: u?.terms_version ?? null };
  const privacy = { current: cur("privacy"), accepted: u?.privacy_version ?? null };
  return {
    required: (!!terms.current && terms.accepted !== terms.current) || (!!privacy.current && privacy.accepted !== privacy.current),
    terms, privacy,
    training: { granted: !!u?.training_consent, version: u?.training_consent_version ?? null, current: cur("training_consent") },
    pendingLegalReview: docs.some((d) => d.legal_review_status !== "approved"),
  };
}

/** Accept Terms + Privacy (exact current versions must be echoed back) and optionally set training consent. */
export async function acceptConsent(userId: string, body: { terms: string; privacy: string; training?: boolean }, source: ConsentSource, userAgent?: string | null) {
  const st = await consentStatus(userId);
  if (body.terms !== st.terms.current || body.privacy !== st.privacy.current)
    throw new HttpError(409, "stale_documents", "The terms were updated while you were reading. Please review the latest version.", { current: { terms: st.terms.current, privacy: st.privacy.current } });
  await tx(async (c) => {
    await lockUser(c, userId);
    await c.query(`update app_users set terms_version=$2, privacy_version=$3, terms_accepted_at=now() where id=$1`, [userId, body.terms, body.privacy]);
    await c.query(`insert into consent_events (user_id,kind,version,action,source,user_agent) values ($1,'terms',$2,'accepted',$4,$5),($1,'privacy',$3,'accepted',$4,$5)`,
      [userId, body.terms, body.privacy, source, userAgent?.slice(0, 300) ?? null]);
  });
  if (typeof body.training === "boolean") await setTrainingConsent(userId, body.training, source, userAgent);
  return consentStatus(userId);
}

export async function setTrainingConsent(userId: string, granted: boolean, source: ConsentSource, userAgent?: string | null) {
  const st = await consentStatus(userId);
  if (granted && !st.training.current) throw new HttpError(409, "no_training_document", "Training consent is not available yet.");
  if (st.training.granted === granted && (!granted || st.training.version === st.training.current)) return st;
  await tx(async (c) => {
    await lockUser(c, userId);
    await c.query(`update app_users set training_consent=$2, training_consent_version=$3, training_consent_at=now() where id=$1`, [userId, granted, granted ? st.training.current : null]);
    await c.query(`insert into consent_events (user_id,kind,version,action,source,user_agent) values ($1,'training_consent',$2,$3,$4,$5)`,
      [userId, st.training.current ?? "n/a", granted ? "granted" : "revoked", source, userAgent?.slice(0, 300) ?? null]);
    await c.query(`insert into privacy_requests (user_id,kind,status,completed_at) values ($1,$2,'completed',now())`, [userId, granted ? "opt_in_training" : "opt_out_training"]);
  });
  return consentStatus(userId);
}

export type ConsentRow = { terms_version: string | null; privacy_version: string | null; training_consent: boolean | null; training_consent_version: string | null };

export async function requireConsent(userId: string, row?: ConsentRow | null) {
  const st = await consentStatus(userId, row);
  if (st.required) throw new HttpError(428, "consent_required", "Please review and accept the updated Terms of Service and Privacy Policy to continue.", { consent: st });
}
