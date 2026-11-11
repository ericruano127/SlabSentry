import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Self-contained server bundle for containers (monorepo root so workspace packages are traced).
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@slabguard/core"],
  // Loaded with require() at runtime (not bundled) so OpenTelemetry can instrument them.
  serverExternalPackages: ["pg", "ioredis", "@opentelemetry/sdk-node", "@opentelemetry/instrumentation", "@opentelemetry/instrumentation-http",
    "@opentelemetry/instrumentation-undici", "@opentelemetry/instrumentation-pg", "@opentelemetry/instrumentation-ioredis",
    "@opentelemetry/sdk-trace", "@opentelemetry/sdk-logs", "@opentelemetry/exporter-trace-otlp-proto", "@opentelemetry/exporter-logs-otlp-proto"],
  poweredByHeader: false,
  async headers() {
    const prod = process.env.NODE_ENV === "production";
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
        ],
      },
      // Pages get a per-request nonce policy from proxy.ts (lib/csp.ts). API responses are data, never
      // pages: nothing in them may load or run.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }] },
    ];
  },
};
export default config;
