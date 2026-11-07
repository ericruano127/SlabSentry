import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env";
import { HttpError } from "./http";
import { ensureUser } from "./users";

export interface AuthUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

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
      throw new HttpError(401, "invalid_token", "Session expired. Please sign in again.");
    }
    const email = (p.email as string) ?? null;
    // Supabase is configured with "Confirm email" on, so it only issues sessions
    // to confirmed email addresses (OAuth identities are verified by the provider).
    user = { id: p.sub!, email, emailVerified: true, isAdmin: false };
  } else if (env.devAuth) {
    const dev = req.headers.get("x-dev-user") ?? cookie(req, "dev_user");
    if (dev && UUID.test(dev)) user = { id: dev, email: `${dev.slice(0, 8)}@dev.local`, emailVerified: true, isAdmin: false };
  }
  if (!user) {
    if (opts.optional) return null;
    throw new HttpError(401, "unauthenticated", "Please sign in.");
  }
  const row = await ensureUser(user.id, user.email);
  if (row.deleted_at) throw new HttpError(403, "account_deleted", "This account has been deleted.");
  user.isAdmin = row.is_admin || (!!user.email && env.adminEmails.includes(user.email.toLowerCase()));
  return user;
}

export async function requireUser(req: Request) {
  return (await getUser(req))!;
}

export async function requireAdmin(req: Request) {
  const u = await requireUser(req);
  if (!u.isAdmin) throw new HttpError(403, "forbidden", "Admin only");
  return u;
}

function cookie(req: Request, name: string) {
  const m = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
