import { q } from "./db";

/**
 * Production startup checks. The server refuses to start in production when it is misconfigured
 * in ways that would weaken security or launch unreviewed legal text.
 */
export async function assertProductionReady(env = process.env): Promise<string[]> {
  const problems: string[] = [];
  if (env.NODE_ENV !== "production") return problems;
  if (env.AUTH_MODE === "dev" || env.NEXT_PUBLIC_AUTH_MODE === "dev") problems.push("AUTH_MODE=dev must not be set in production");
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) problems.push("Supabase auth is not configured");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) problems.push("SUPABASE_SERVICE_ROLE_KEY missing (needed for private storage and account deletion)");
  if (!env.VISION_API_KEY) problems.push("VISION_API_KEY missing (vision service must not be callable without a key)");
  if (!env.CERT_HASH_SECRET || env.CERT_HASH_SECRET.length < 32) problems.push("CERT_HASH_SECRET missing or shorter than 32 characters (cloned-cert index keys)");
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) problems.push("STRIPE_WEBHOOK_SECRET missing");
  if (env.REVENUECAT_SECRET_API_KEY && !env.REVENUECAT_WEBHOOK_AUTH) problems.push("REVENUECAT_WEBHOOK_AUTH missing");
  if (!/sslmode=(require|verify-full)/.test(env.DATABASE_URL ?? "") && !isLocalDbHost(env.DATABASE_URL)) problems.push("DATABASE_URL must use sslmode=require (TLS in transit)");
  if (env.ALLOW_UNREVIEWED_LEGAL !== "1") {
    const pending = await q(`select kind, version from legal_documents where published and legal_review_status <> 'approved'`).catch(() => []);
    if (pending.length) problems.push(`legal documents pending legal review: ${pending.map((p) => `${p.kind}@${p.version}`).join(", ")}`);
  }
  return problems;
}

/**
 * A database on the same machine or private container network, where TLS adds nothing: localhost, or a
 * single-label host such as Docker Compose's `postgres` service. Anything with a dot (a real network
 * hostname) must use TLS.
 */
export function isLocalDbHost(url?: string): boolean {
  let host: string;
  try { host = new URL(url ?? "").hostname.replace(/^\[|\]$/g, ""); } catch { return false; }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || (!!host && !host.includes(".") && !host.includes(":"));
}
