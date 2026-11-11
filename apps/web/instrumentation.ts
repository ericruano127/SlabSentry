export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Telemetry first (no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set), so request/DB/fetch spans are captured.
  const { startTelemetry } = await import("./lib/telemetry.mjs");
  await startTelemetry("slabsentry-web");
  const { assertProductionReady } = await import("./lib/startup");
  const problems = await assertProductionReady();
  // Throwing here aborts server startup.
  if (problems.length) throw new Error(`Refusing to start:\n - ${problems.join("\n - ")}`);
}
