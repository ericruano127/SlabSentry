import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "../lib/csp";

const parse = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

describe("Content-Security-Policy", () => {
  it("production: nonce + strict-dynamic scripts, no unsafe-inline/eval for scripts, nonce-only <style>", () => {
    const p = parse(buildCsp({ nonce: "abc", supabaseUrl: "https://proj.supabase.co/" }));
    expect(p["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(p["style-src-elem"]).toEqual(["'self'", "'nonce-abc'"]);
    expect(p["style-src-attr"]).toEqual(["'unsafe-inline'"]); // React style={{}} attributes
    expect(p["object-src"]).toEqual(["'none'"]);
    expect(p["base-uri"]).toEqual(["'none'"]);
    expect(p["frame-ancestors"]).toEqual(["'none'"]);
    expect(p["form-action"]).toEqual(["'self'"]);
    expect(p["upgrade-insecure-requests"]).toEqual([]);
    expect(p["report-uri"]).toEqual(["/api/csp-report"]);
  });

  it("allows exactly the configured Supabase origin (no wildcard), for API calls and signed photo URLs", () => {
    const p = parse(buildCsp({ nonce: "n", supabaseUrl: "https://proj.supabase.co/some/path" }));
    expect(p["connect-src"]).toEqual(["'self'", "https://proj.supabase.co"]);
    expect(p["img-src"]).toContain("https://proj.supabase.co");
    expect(buildCsp({ nonce: "n", supabaseUrl: "https://proj.supabase.co" })).not.toContain("*");
    expect(parse(buildCsp({ nonce: "n", supabaseUrl: "not a url" }))["connect-src"]).toEqual(["'self'"]);
  });

  it("development adds only what the dev server needs", () => {
    const p = parse(buildCsp({ nonce: "n", dev: true }));
    expect(p["script-src"]).toContain("'unsafe-eval'");
    expect(p["script-src"]).not.toContain("'unsafe-inline'");
    expect(p["upgrade-insecure-requests"]).toBeUndefined();
  });

  it("nonces are 128-bit random values", () => {
    const a = newNonce(), b = newNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });
});
