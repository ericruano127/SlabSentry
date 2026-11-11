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
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ...(process.env.NODE_ENV === "production"
          ? [
              { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
              {
                key: "Content-Security-Policy",
                value: [
                  "default-src 'self'",
                  "script-src 'self' 'unsafe-inline'", // Next.js inline bootstrap; tighten with nonces later
                  "style-src 'self' 'unsafe-inline'",
                  "img-src 'self' blob: data:",
                  "media-src 'self' blob:",
                  `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://*.supabase.co`,
                  "frame-ancestors 'none'",
                  "base-uri 'self'",
                  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
                ].join("; "),
              },
            ]
          : []),
      ],
    }];
  },
};
export default config;
