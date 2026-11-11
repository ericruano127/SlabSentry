import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, CSP_REPORT_PATH, newNonce } from "@/lib/csp";

/**
 * Adds a per-request Content-Security-Policy with a fresh nonce to every page. Next.js reads the
 * nonce from the request's CSP header while rendering and puts it on its own script tags.
 * Pages are rendered per request (app/layout.tsx), so every page gets a nonce.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Reporting-Endpoints", `csp="${CSP_REPORT_PATH}"`);
  return res;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes get a fixed lock-down policy (next.config.ts); static files need none.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
