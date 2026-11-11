import { appMetrics } from "./appMetrics";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env";
import { HttpError } from "./http";
import { requireConsent } from "./consent";
import type { Role } from "./rbac";
import { ensureUser } from "./users";

export interface AuthUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  isAdmin: boolean; // role is admin or owner (UI convenience)
  role: Role;
  aal: "aal1" | "aal2"; // authenticator assurance level; aal2 = MFA verified this session
  /** The app_users row loaded while authenticating (reused for consent and profile; not serialized). */
  row?: Record<string, any>;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** Server-side 2FA enforcement: Supabase issues aal1 sessions even when a factor is enrolled, so we
 * check enrollment (cached 5 min) and reject aal1 sessions for enrolled users. */
const mfaCache = new Map<string, { at: number; enrolled: boolean }>();
async function mfaEnrolled(userId: string): Promise<boolean> {
  if (!env.supabaseUrl || !env.supabaseServiceKey) return false;
  const hit = mfaCache.get(userId);
  if (hit && Date.now() - hit.at < 300_000) return hit.enrolled;
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return hit?.enrolled ?? false;
  const enrolled = (data?.factors ?? []).some((f: any) => f.status === "verified");
  mfaCache.set(userId, { at: Date.now(), enrolled });
  return enrolled;
}

async function verifySupabaseJwt(token: string): Promise<JWTPayload> {
  if (env.supabaseJwtSecret) {
    return (await jwtVerify(token, new TextEncoder().encode(env.supabaseJwtSecret), { audience: "authenticated" })).payload;
  }
  if (!env.supabaseUrl) throw new HttpError(500, "auth_not_configured", "Authentication is not configured");
  jwks ??= createRemoteJWKSet(new URL(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return (await jwtVerify(token, jwks, { audience: "authenticated" })).payload;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the caller. Client-supplied plan/credit values are never read. */
export async function getUser(req: Request, opts: { optional?: boolean } = {}): Promise<AuthUser | null> {
  const h = req.headers.get("authorization");
  let user: AuthUser | null = null;
  if (h?.startsWith("Bearer ")) {
    let p: JWTPayload;
    try {
      p = await verifySupabaseJwt(h.slice(7));
    } catch {
      appMetrics.authFailures.add(1, { reason: "invalid_token" }); // expired or forged tokens: alert on spikes
      throw new HttpError(401, "invalid_token", "Session expired. Please sign in again.");
    }
    const email = (p.email as string) ?? null;
    // Supabase is configured with "Confirm email" on, so it only issues sessions
    // to confirmed email addresses (OAuth identities are verified by the provider).
    user = { id: p.sub!, email, emailVerified: true, isAdmin: false, role: "user", aal: (p as any).aal === "aal2" ? "aal2" : "aal1" };
    if (user.aal === "aal1" && (await mfaEnrolled(user.id)))
      throw new HttpError(401, "mfa_challenge_required", "Enter your two-factor code to continue.");
  } else if (env.devAuth) {
    const dev = req.headers.get("x-dev-user") ?? cookie(req, "dev_user");
    const aal = (req.headers.get("x-dev-aal") ?? cookie(req, "dev_aal")) === "aal2" ? "aal2" : "aal1";
    if (dev && UUID.test(dev)) user = { id: dev, email: `${dev.slice(0, 8)}@dev.local`, emailVerified: true, isAdmin: false, role: "user", aal };
  }
  if (!user) {
    if (opts.optional) return null;
    throw new HttpError(401, "unauthenticated", "Please sign in.");
  }
  const row = await ensureUser(user.id, user.email);
  if (row.deleted_at) throw new HttpError(403, "account_deleted", "This account has been deleted.");
  // ADMIN_EMAILS bootstraps the first owner; afterwards roles are managed in the database (audited).
  user.role = row.role !== "user" ? row.role : !!user.email && env.adminEmails.includes(user.email.toLowerCase()) ? "owner" : "user";
  user.isAdmin = user.role === "admin" || user.role === "owner";
  Object.defineProperty(user, "row", { value: row, enumerable: false });
  return user;
}

/**
 * Authenticated user who has accepted the current Terms + Privacy. Routes that must work before
 * acceptance (profile/consent/legal/account deletion/data export) pass { skipConsent: true }.
 */
export async function requireUser(req: Request, opts: { skipConsent?: boolean } = {}) {
  const u = (await getUser(req))!;
  if (!opts.skipConsent) await requireConsent(u.id, u.row as any);
  return u;
}

function cookie(req: Request, name: string) {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
