import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/slabguard_test",
      INLINE_WORKER: "0",
      LOCAL_STORAGE_DIR: "/tmp/slabguard-test-uploads",
      STRIPE_SECRET_KEY: "sk_test_dummy",
      STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
      REVENUECAT_WEBHOOK_AUTH: "Bearer rc-test-secret",
      VISION_URL: process.env.VISION_URL ?? "http://127.0.0.1:8001",
    },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
