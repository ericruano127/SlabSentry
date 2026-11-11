/**
 * Preload for Node processes that run the app as ES modules (the analysis worker):
 *   node --import ./apps/web/scripts/otel-preload.mjs --import <tsx loader> apps/web/scripts/worker.ts
 * ES-module instrumentation needs its loader hook registered and the SDK started BEFORE app modules
 * load. No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
import { register } from "node:module";
import { startTelemetry, telemetryEnabled } from "../lib/telemetry.mjs";

if (telemetryEnabled()) {
  // Only third-party packages need wrapping (pg, ioredis, …); our own TypeScript modules never do.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url, { data: { exclude: [/\.tsx?$/, /\/packages\/core\//] } });
  await startTelemetry(process.env.OTEL_SERVICE_NAME ?? "slabsentry-worker");
}
