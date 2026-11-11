/** Telemetry privacy: everything that leaves the app (spans, span events, log records) is redacted. */
import { describe, expect, it } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { ProbeFilterSampler, RedactingLogProcessor, RedactingSpanProcessor, redactText, telemetryEnabled } from "../lib/telemetry.mjs";
import { AlwaysOnSampler } from "@opentelemetry/sdk-trace";
import { routeLabel } from "../lib/appMetrics";

const SESSION = "9f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

describe("redactText", () => {
  it.each([
    ["https://api.psacard.com/publicapi/cert/GetByCertNumber/12345678", "https://api.psacard.com/publicapi/cert/GetByCertNumber/[number]"],
    ["/api/sessions?q=12345678", "/api/sessions?[redacted]"],
    ["https://x.supabase.co/storage/v1/object/sign/b/k.jpg?token=eyJhbGciOi", "https://x.supabase.co/storage/v1/object/sign/b/k.jpg?[redacted]"],
    ["mail bob.smith+cards@example.co.uk now", "mail [email] now"],
    [`session ${SESSION} done`, `session ${SESSION} done`], // pseudonymous ids kept for correlation
    ["select * from t where id=$1", "select * from t where id=$1"],
    ["PSA 10 (grade) 2024", "PSA 10 (grade) 2024"], // short numbers are fine
  ])("%s", (input, out) => expect(redactText(input)).toBe(out));
});

describe("span redaction (real SDK spans)", () => {
  it("scrubs attributes, span names, events and status before export; drops header/body attributes", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({ spanProcessors: [new RedactingSpanProcessor(), new SimpleSpanProcessor({ exporter })] });
    const span = provider.getTracer("t").startSpan("GET /lookup/12345678");
    span.setAttributes({
      "url.full": "https://api.psacard.com/cert/GetByCertNumber/12345678?key=abc",
      "url.query": "q=12345678", "db.statement": "select 1", "session.id": SESSION,
      "http.request.header.authorization": "Bearer secret", "http.request.body": "{\"email\":\"a@b.co\"}",
      "enduser.email": "bob@example.com",
    });
    span.addEvent("exception", { "exception.message": "lookup failed for 12345678 (bob@example.com)" });
    span.setStatus({ code: 2, message: "cert 12345678 not found" });
    span.end();
    await provider.forceFlush();
    const [s] = exporter.getFinishedSpans();
    const all = JSON.stringify({ name: s.name, attrs: s.attributes, events: s.events, status: s.status });
    for (const leak of ["12345678", "bob@example.com", "a@b.co", "Bearer secret", "key=abc"]) expect(all).not.toContain(leak);
    expect(s.attributes["session.id"]).toBe(SESSION);
    expect(s.attributes["http.request.header.authorization"]).toBe("[redacted]");
    expect(s.attributes["http.request.body"]).toBe("[redacted]");
    expect(s.name).toBe("GET /lookup/[number]");
  });
});

describe("log redaction (real SDK log records)", () => {
  it("scrubs the body and string attributes", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new RedactingLogProcessor(), new SimpleLogRecordProcessor({ exporter })] });
    provider.getLogger("t").emit({ body: "user bob@example.com cert 98765432", attributes: { url: "https://x/y?token=t0k", password: "hunter2", route: "/api/me" } });
    await provider.forceFlush();
    const [r] = exporter.getFinishedLogRecords();
    expect(r.body).toBe("user [email] cert [number]");
    expect(r.attributes).toMatchObject({ url: "https://x/y?[redacted]", password: "[redacted]", route: "/api/me" });
  });
});

describe("telemetry switches and metric labels", () => {
  it("is off without an OTLP endpoint (tests and local dev export nothing)", () => {
    expect(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(telemetryEnabled()).toBe(false);
  });
  it("route labels stay low-cardinality", () => {
    expect(routeLabel(`/api/sessions/${SESSION}/images`, 201)).toEqual({ route: "/api/sessions/:id/images" });
    expect(routeLabel("/api/admin/releases/42/publish", 200)).toEqual({ route: "/api/admin/releases/:n/publish" });
    expect(routeLabel("/wp-login.php", 404)).toEqual({ route: "other" });
    expect(routeLabel("/api/anything/random", 404)).toEqual({ route: "other" });
  });
});

describe("probe filtering", () => {
  it("drops health/ready/metrics root spans and keeps real traffic", () => {
    const s = new ProbeFilterSampler(new AlwaysOnSampler());
    const d = (name: string, attrs = {}) => (s.shouldSample({} as any, "t", name, 1, attrs, []) as any).decision;
    expect(d("GET /api/health")).toBe(0);
    expect(d("GET", { "url.path": "/api/ready" })).toBe(0);
    expect(d("GET /api/metrics")).toBe(0);
    expect(d("GET /api/sessions/[id]")).not.toBe(0);
    expect(d("analysis.job")).not.toBe(0);
  });
});
