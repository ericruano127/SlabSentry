import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@slabguard/core"],
  serverExternalPackages: ["pg"],
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
