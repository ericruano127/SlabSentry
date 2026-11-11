/**
 * Content-Security-Policy for HTML pages. Built per request by proxy.ts with a fresh nonce:
 * only scripts the server put on the page (Next.js tags carrying the nonce, and what those load —
 * 'strict-dynamic') can run. Injected <script> tags, inline event handlers and javascript: URLs are blocked.
 *
 * Styles: <style> elements need the nonce too. Inline style="" attributes stay allowed — React's
 * style={{…}} props render as attributes, nonces can't cover attributes, and attribute styles can't run code.
 */
export type CspOptions = {
  nonce: string;
  /** Development server: React needs eval for debugging, and the dev overlay injects styles. */
  dev?: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: sign-in API calls, and private photos (redirected to short-lived signed storage URLs). */
  supabaseUrl?: string;
  /** Where browsers send violation reports. */
  reportPath?: string;
};

export const CSP_REPORT_PATH = "/api/csp-report";

function origin(url?: string) {
  try { return url ? new URL(url).origin : ""; } catch { return ""; }
}

export function buildCsp({ nonce, dev = false, supabaseUrl, reportPath = CSP_REPORT_PATH }: CspOptions): string {
  const supabase = origin(supabaseUrl);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Older browsers without style-src-elem/-attr fall back to this.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["style-src-elem", "'self'", ...(dev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    ["style-src-attr", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:", ...(supabase ? [supabase] : [])],
    ["media-src", "'self'", "blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(supabase ? [supabase] : [])],
    ["worker-src", "'self'", "blob:"],
    ["object-src", "'none'"],
    ["frame-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["manifest-src", "'self'"],
    ...(dev ? [] : [["upgrade-insecure-requests"] as [string]]),
    ["report-uri", reportPath],
    ["report-to", "csp"],
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
