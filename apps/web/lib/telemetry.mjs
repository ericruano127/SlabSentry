/**
 * OpenTelemetry for the web app and workers (traces, metrics, logs → OTLP, e.g. Grafana Cloud).
 *
 * Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (and OTEL_SDK_DISABLED isn't "true"), so local
 * development and tests export nothing. Endpoint and auth come from the standard variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS (secret), OTEL_SERVICE_NAME,
 *   OTEL_RESOURCE_ATTRIBUTES (e.g. "service.namespace=staging,deployment.environment.name=staging").
 *
 * PRIVACY: every span (including Next.js' own spans and exception events) passes through
 * `RedactingSpanProcessor` before export: query strings are dropped (search terms, signed-URL tokens),
 * long digit runs are masked (certification numbers in grader API URLs), email addresses are masked,
 * and request/response bodies are never recorded. Log records get the same treatment.
 *
 * Plain JavaScript (.mjs) so the worker can preload it with `node --import` before any app module
 * loads, which ES-module instrumentation requires (see scripts/otel-preload.mjs).
 */
import { trace } from "@opentelemetry/api";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const QUERY = /\?[^\s"'#]*/g;
const LONG_DIGITS = /\d{6,}/g;

/**
 * Remove personal or sensitive values from free text (URLs, SQL, error messages).
 * UUIDs (pseudonymous session/user ids, needed to follow a request) are kept intact.
 */
export function redactText(s) {
  if (typeof s !== "string" || !s) return s;
  const keep = [];
  let out = s.replace(UUID, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  out = out.replace(EMAIL, "[email]").replace(QUERY, (q) => (q.length > 1 ? "?[redacted]" : q)).replace(LONG_DIGITS, "[number]");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]);
}

/** Attribute keys that may carry bodies or credentials: dropped outright. */
const DROP = /(^|\.)(body|cookie|authorization|set-cookie|password|token|secret|api[_-]?key)(\.|$)|^http\.request\.header\.|^http\.response\.header\./i;

const redactValue = (k, v) => (DROP.test(k) ? "[redacted]" : typeof v === "string" ? redactText(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? redactText(x) : x)) : v);

/** Redact a plain attributes object in place (used for span events, which have no setter API). */
export function redactAttributes(attrs) {
  if (!attrs) return attrs;
  for (const k of Object.keys(attrs)) attrs[k] = redactValue(k, attrs[k]);
  return attrs;
}

/** Redact through the record's own setter (spans while ending, log records while emitting). */
function redactVia(attrs, set) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    const r = redactValue(k, v);
    if (r !== v) set(k, r);
  }
}

/** Span processor that scrubs a span while it's still writable (onEnding), before any exporter sees it. */
export class RedactingSpanProcessor {
  onStart() {}
  onEnding(span) {
    redactVia(span.attributes, (k, v) => span.setAttribute(k, v));
    if (typeof span.name === "string") span.updateName?.(redactText(span.name));
    for (const e of span.events ?? []) redactAttributes(e.attributes);
    if (span.status?.message) span.status.message = redactText(span.status.message);
  }
  onEnd() {}
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

/** Log record processor with the same rules (runs before the exporting processor). */
export class RedactingLogProcessor {
  onEmit(record) {
    if (typeof record.body === "string") record.setBody(redactText(record.body));
    redactVia(record.attributes, (k, v) => record.setAttribute(k, v));
  }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

const PROBE = /\/api\/(health|ready|metrics)\b|^\/_next\//;

/**
 * Root-span sampler: drops health/readiness/metrics probes (Fly checks every 15 s per Machine; Next.js
 * creates its own spans for them, so ignoring them in the HTTP instrumentation isn't enough), then
 * samples the rest at OTEL_TRACES_SAMPLER_ARG (default 1 = everything; e.g. 0.1 at high traffic).
 * Child spans follow their parent's decision, so a trace is kept or dropped as a whole.
 */
export class ProbeFilterSampler {
  constructor(inner) { this.inner = inner; }
  shouldSample(ctx, traceId, name, kind, attrs, links) {
    const target = String(attrs?.["url.path"] ?? attrs?.["http.target"] ?? attrs?.["next.route"] ?? attrs?.["http.route"] ?? "");
    if (PROBE.test(name) || PROBE.test(target)) return { decision: 0 }; // SamplingDecision.NOT_RECORD
    return this.inner.shouldSample(ctx, traceId, name, kind, attrs, links);
  }
  toString() { return `ProbeFilterSampler(${this.inner})`; }
}

export const telemetryEnabled = () => !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== "true";

let started = null;

/** Start the SDK once per process. Returns null when telemetry is off. */
export async function startTelemetry(defaultServiceName) {
  if (started || !telemetryEnabled()) return started;
  process.env.OTEL_SERVICE_NAME ??= defaultServiceName;
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN ??= "http"; // stable HTTP names, e.g. http.server.request.duration (seconds)
  // Fly sets FLY_MACHINE_ID: one series per Machine so counters from different instances never mix.
  if (process.env.FLY_MACHINE_ID && !/service\.instance\.id=/.test(process.env.OTEL_RESOURCE_ATTRIBUTES ?? ""))
    process.env.OTEL_RESOURCE_ATTRIBUTES = [process.env.OTEL_RESOURCE_ATTRIBUTES, `service.instance.id=${process.env.FLY_MACHINE_ID}`].filter(Boolean).join(",");

  const [{ NodeSDK }, { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler }, { OTLPTraceExporter }, { BatchLogRecordProcessor }, { OTLPLogExporter }, http, undici, pg, ioredis] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/sdk-trace"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/exporter-logs-otlp-proto"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-undici"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/instrumentation-ioredis"),
  ]);

  const ratio = Math.min(1, Math.max(0, Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? 1)));
  const sdk = new NodeSDK({
    sampler: new ParentBasedSampler({ root: new ProbeFilterSampler(new TraceIdRatioBasedSampler(ratio)) }),
    // Redaction first, then export. (Metrics come from the standard OTEL_METRICS_* env configuration.)
    // (SDK 3.x processors take an options object: { exporter }.)
    spanProcessors: [new RedactingSpanProcessor(), new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })],
    logRecordProcessors: [new RedactingLogProcessor(), new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [
      new http.HttpInstrumentation({
        // health/readiness/metrics probes would drown out real traffic
        ignoreIncomingRequestHook: (req) => /^\/api\/(health|ready|metrics)\b/.test(req.url ?? "") || (req.url ?? "").startsWith("/_next/"),
      }),
      new undici.UndiciInstrumentation(), // fetch(): vision, grader APIs, Supabase — propagates trace context to the vision service
      new pg.PgInstrumentation({ enhancedDatabaseReporting: false }), // SQL text with $n placeholders only — never parameter values
      new ioredis.IORedisInstrumentation({ dbStatementSerializer: (cmd) => cmd }), // command name only — keys can contain user ids
    ],
  });
  sdk.start();
  started = sdk;
  // Flush buffered telemetry on shutdown. A SIGTERM listener disables Node's default exit, so exit
  // ourselves unless another handler (e.g. Next.js' graceful shutdown) is in charge.
  const flush = () => Promise.race([sdk.shutdown().catch(() => {}), new Promise((r) => setTimeout(r, 5000).unref())]);
  process.once("SIGTERM", () => { flush().then(() => { if (process.listenerCount("SIGTERM") === 0) process.exit(0); }); });
  process.once("beforeExit", flush);
  return sdk;
}

/** Current trace/span ids (for JSON log correlation), or {} outside a span. */
export function traceIds() {
  const c = trace.getActiveSpan()?.spanContext();
  return c && c.traceId !== "00000000000000000000000000000000" ? { trace_id: c.traceId, span_id: c.spanId } : {};
}
