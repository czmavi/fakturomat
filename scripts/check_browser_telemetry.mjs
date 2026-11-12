// Optional offline QA; invocation and fixture generation are in DEPLOYMENT.md.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const [fixturePath, sdkPath] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const sdk = await readFile(sdkPath, "utf8");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
});
try {
  const page = await browser.newPage();
  const app = "https://fakturomat.test";
  const control = "https://controlpanel.caretsix.com";
  const received = [], blocked = [], violations = [];
  let sdkLoads = 0, collectorUnavailable = false, lookupFails = false;
  // Exercise the hook with a real Preact boundary in an isolated root.
  const boundary = execFileSync("node_modules/.bin/esbuild", [
    "--bundle",
    "--format=esm",
    "--loader=ts",
  ], {
    input: `
    import { h, render, Component } from "preact";
    import { installPreactTelemetry } from "./client/telemetry.ts";
    installPreactTelemetry();
    class Boundary extends Component {
      static getDerivedStateFromError() { return { failed: true }; }
      render(p,s) { return s.failed ? "boundary recovered" : p.children; }
    }
    function Broken() { throw new Error("boundary private@example.test"); }
    render(h(Boundary,null,h(Broken)),document.body.appendChild(document.createElement("aside")));
  `,
  });
  await page.exposeFunction("reportViolation", (uri) => violations.push(uri));
  await page.addInitScript(() =>
    document.addEventListener(
      "securitypolicyviolation",
      (e) => globalThis.reportViolation(e.blockedURI),
    )
  );
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === control + "/telemetry/browser-v1.js") {
      sdkLoads++;
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": app },
        body: sdk,
      });
    }
    if (url.href === control + "/v1/traces") {
      const headers = {
        "access-control-allow-origin": app,
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "POST",
      };
      if (request.method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers });
      }
      assert.equal(request.method(), "POST");
      const sent = await request.allHeaders();
      assert.equal(sent.origin, app);
      assert.ok(
        !sent.authorization && !sent.cookie && !sent["content-encoding"],
      );
      const body = request.postData();
      for (
        const secret of [
          "private@example.test",
          "12345678",
          "test-cookie",
          "test-token",
        ]
      ) assert.ok(!body.includes(secret));
      received.push(...JSON.parse(body).resourceSpans[0].scopeSpans[0].spans);
      return route.fulfill({
        status: collectorUnavailable ? 503 : 204,
        headers,
      });
    }
    if (url.origin === app) {
      if (url.pathname === "/organizations/new") {
        return route.fulfill({
          contentType: "text/html",
          headers: { "content-security-policy": fixture.csp },
          body: fixture.html,
        });
      }
      if (url.pathname === "/boundary.js") {
        return route.fulfill({
          contentType: "text/javascript",
          body: boundary,
        });
      }
      if (url.pathname === "/api/ares") {
        if (lookupFails) {
          return route.fulfill({
            status: 502,
            json: { error: "Test ARES private@example.test" },
          });
        }

        return route.fulfill({
          json: {
            ico: "12345678",
            name: "Test",
            dic: "",
            street: "",
            city: "",
            postalCode: "",
            country: "CZ",
            contactType: "PERSON",
          },
        });
      }
      if (/^\/assets\/[\w.-]+$/.test(url.pathname)) {
        return route.fulfill({
          path: path.join("_fresh/client", url.pathname),
        });
      }
      if (/^\/(favicon|site.webmanifest)/.test(url.pathname)) {
        return route.fulfill({ status: 204 });
      }
    }
    blocked.push(url.pathname);
    await route.abort();
  });
  await page.context().addCookies([{
    name: "session",
    value: "test-cookie",
    url: app,
  }]);
  await page.goto(app + "/organizations/new?token=test-token");
  assert.equal(sdkLoads, 1);
  assert.equal(
    await page.locator('script[src$="browser-v1.js"]').getAttribute(
      "crossorigin",
    ),
    "anonymous",
  );
  await page.locator('input[name="ico"]').fill("12345678");
  await page.getByRole("button", { name: "Načíst údaje z ARES podle IČO" })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('input[name="official_name"]').value === "Test"
  );
  await page.evaluate(() => globalThis.CaretSixControl.flush());
  assert.deepEqual(received.map((s) => [s.name, s.status.code]), [[
    "contact.ares.lookup",
    1,
  ]]);
  lookupFails = true;
  await page.getByRole("button", { name: "Načíst údaje z ARES podle IČO" })
    .click();
  await page.getByRole("alert").waitFor();
  await page.evaluate(() => globalThis.CaretSixControl.flush());
  await page.addScriptTag({ url: app + "/boundary.js", type: "module" });
  await page.getByText("boundary recovered").waitFor();
  await page.evaluate(() => globalThis.CaretSixControl.flush());
  await Promise.all([
    page.waitForEvent("pageerror"),
    page.evaluate(() => {
      setTimeout(() => {
        throw new Error("global private@example.test");
      }, 0);
    }),
  ]);
  await Promise.all([
    page.waitForEvent("pageerror"),
    page.evaluate(() => {
      void Promise.reject(new Error("rejection private@example.test"));
    }),
  ]);
  collectorUnavailable = true;
  await page.evaluate(() => globalThis.CaretSixControl.flush());
  assert.deepEqual(received.map((s) => s.name), [
    "contact.ares.lookup",
    "contact.ares.lookup",
    "browser.exception",
    "browser.exception",
    "browser.exception",
  ]);
  for (const s of received.slice(1)) {
    assert.equal(s.status.code, 2);
    assert.deepEqual(s.events.map((e) => [e.name, e.attributes]), [[
      "exception",
      [],
    ]]);
  }
  assert.equal(
    await page.locator('input[name="official_name"]').inputValue(),
    "Test",
  );
  assert.deepEqual(violations, []);
  assert.deepEqual(blocked, []);
  console.log(
    "Browser telemetry passed: Fresh hydration, ARES span, caught and uncaught errors, CSP, privacy and collector 503.",
  );
} finally {
  await browser.close();
}
