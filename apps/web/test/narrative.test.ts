/** AI narrative request shape + guardrails, against a local fake Messages API (no real model call). */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReport, runEngine, type EngineInput } from "@slabguard/core";

let reply: any = null;
const seen: { headers: any; body: any }[] = [];
const server = createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    seen.push({ headers: req.headers, body: JSON.parse(data) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply));
  });
});

let gen: typeof import("../lib/ai/narrate").generateNarrative;
const q = { ok: true, score: 1, issues: [], metrics: {} };
const input: EngineInput = {
  mode: "in_hand", grader: "PSA", certNumber: "12345678", certSource: "qr", certUserConfirmed: true,
  record: { grader: "PSA", certNumber: "12345678", found: true, grade: "10", verificationUrl: "https://www.psacard.com/cert/12345678", provenance: { source: "official_api", retrievedAt: "x" } },
  labelOcrText: [], images: [{ id: "a", role: "front", quality: q }], comparisons: [], holder: null, now: "2026-01-01T00:00:00Z",
};
const report = buildReport("s1", input, runEngine(input));
const msg = (text: string, stop = "end_turn") => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: stop, stop_details: null, usage: { input_tokens: 1000, output_tokens: 200 } });

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  gen = (await import("../lib/ai/narrate")).generateNarrative;
});
afterAll(() => server.close());

describe("AI narrative", () => {
  it("sends the structured report only, with refusal fallback and low effort", async () => {
    const good = `Overall: ${report.assessmentLabel}. The grader's record for this cert was found, which confirms the number exists. No reference image was available, so the card itself could not be compared with the grader's photos. Next, open the official PSA lookup and compare the images with the slab in hand before you buy.`;
    reply = msg(good);
    const n = await gen(report);
    expect(n.source).toBe("ai");
    expect(n.text).toBe(good);
    expect(n.costUsd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6);
    const { headers, body } = seen.at(-1)!;
    expect(headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body.fallbacks).toBe("default");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.thinking).toBeUndefined();
    const content = body.messages[0].content as string;
    expect(content).not.toMatch(/"sessionId"|imageRefs|storage_key|@/);
  });

  it("falls back to the rule-based template when the model claims authenticity", async () => {
    reply = msg(`Overall: ${report.assessmentLabel}. Good news: this slab is genuine and you can buy with confidence. The record matched and everything about the card lines up with what PSA shows.`);
    const n = await gen(report);
    expect([n.source, n.rejected]).toEqual(["template", "forbidden_claim"]);
  });

  it("handles a refusal stop reason", async () => {
    reply = msg("", "refusal");
    const n = await gen(report);
    expect([n.source, n.rejected]).toEqual(["template", "refusal"]);
  });
});
