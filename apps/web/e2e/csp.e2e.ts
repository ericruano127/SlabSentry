import { expect, test } from "./fixtures";

const policy = (h: Record<string, string>) => Object.fromEntries(
  (h["content-security-policy"] ?? "").split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

test.describe("content security policy", () => {
  test("pages get a fresh nonce policy, and every script tag the server sends carries it", async ({ request }) => {
    const nonces = new Set<string>();
    for (const path of ["/", "/pricing", "/legal/terms", "/"]) {
      const res = await request.get(path);
      const p = policy(res.headers());
      const nonce = p["script-src"]?.find((s) => s.startsWith("'nonce-"))?.slice(7, -1);
      expect(nonce, `nonce on ${path}`).toBeTruthy();
      expect(p["script-src"]).toContain("'strict-dynamic'");
      expect(p["script-src"]).not.toContain("'unsafe-inline'");
      expect(p["object-src"]).toEqual(["'none'"]);
      expect(p["frame-ancestors"]).toEqual(["'none'"]);
      expect(p["base-uri"]).toEqual(["'none'"]);
      nonces.add(nonce!);
      // Every <script> in the HTML carries this request's nonce (later scripts are trusted via 'strict-dynamic').
      const tags = (await res.text()).match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) expect(t, `script tag on ${path}`).toContain(`nonce="${nonce}"`);
    }
    expect(nonces.size).toBe(4); // a new nonce on every request, even for the same page
  });

  test("a script or event handler injected into the page (XSS) doesn't run; the page still works", async ({ page, allowCspViolations }) => {
    allowCspViolations(); // this test causes violations on purpose
    // Simulate stored/reflected XSS: the real response, with its real headers, plus attacker markup.
    await page.route("**/pricing", async (route) => {
      const res = await route.fetch();
      const html = (await res.text()).replace("<body>", `<body><script>window.__xss = 1</script><img src="data:,x" onerror="window.__xss = 2"><a id="js" href="javascript:window.__xss=3">x</a>`);
      await route.fulfill({ response: res, body: html });
    });
    await page.goto("/pricing");
    await page.locator("#js").click();
    expect(await page.evaluate(() => (window as any).__xss ?? 0)).toBe(0);
    // The app's own scripts still ran: the nonced inline bootstrap and the framework bundle it loaded.
    // (The injected nodes break React hydration on their own, so the page content isn't checked here.)
    expect(await page.evaluate(() => Array.isArray((window as any).__next_f) && !!(window as any).next?.version)).toBe(true);
  });

  test("API responses are locked down; violation reports are accepted", async ({ request }) => {
    const api = await request.get("/api/health");
    expect(policy(api.headers())["default-src"]).toEqual(["'none'"]);

    const legacy = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({ "csp-report": { "document-uri": "http://localhost:3000/r/secret-token", "violated-directive": "script-src-elem", "blocked-uri": "inline" } }),
    });
    expect(legacy.status()).toBe(204);
    const modern = await request.post("/api/csp-report", {
      headers: { "content-type": "application/reports+json" },
      data: JSON.stringify([{ type: "csp-violation", body: { documentURL: "http://localhost:3000/scan", effectiveDirective: "img-src", blockedURL: "https://evil.example/x.png" } }]),
    });
    expect(modern.status()).toBe(204);
    expect((await request.post("/api/csp-report", { headers: { "content-type": "application/json" }, data: Buffer.from("{not json") })).status()).toBe(400);
  });
});
