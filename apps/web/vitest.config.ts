import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/slabguard_test",
      INLINE_WORKER: "0",
      AUTH_MODE: "dev",
      LOCAL_STORAGE_DIR: "/tmp/slabguard-test-uploads",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
      REVENUECAT_WEBHOOK_AUTH: "Bearer rc-test-secret",
      VISION_URL: process.env.VISION_URL ?? "http://127.0.0.1:8001",
    },
    exclude: ["**/node_modules/**", "e2e/**"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
