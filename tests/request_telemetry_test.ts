import { strict as assert } from "node:assert";
import {
  createHttpTracer,
  recordRequestException,
  recordRequestRoute,
} from "@/services/request_telemetry.ts";

Deno.test("OTLP mock receives bounded sanitized success, failure and exception spans after response", async () => {
  const secret = "test-private", sensitive = "personal@example.test";
  const raw: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const trace = createHttpTracer(async (url, init) => {
    assert.equal(url, "https://controlpanel.caretsix.com/v1/traces");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer " + secret);
    assert.deepEqual([...headers.keys()].sort(), [
      "authorization",
      "content-type",
    ]);
    raw.push(String(init?.body));
    await gate;
    throw new Error("offline");
  });
  const pending: Promise<void>[] = [],
    ctx = {
      waitUntil(p: Promise<void>) {
        pending.push(p);
      },
    };
  const req = new Request(
    "https://example.test/" + sensitive + "?token=hidden",
    { method: "POST", headers: { cookie: secret }, body: sensitive },
  );
  const response = new Response(sensitive, { status: 201 });
  assert.equal(
    await trace(req, secret, ctx, () => Promise.resolve(response)),
    response,
  );
  await trace(
    req,
    secret,
    ctx,
    () => Promise.resolve(new Response(null, { status: 503 })),
  );
  await trace(req, secret, ctx, () => {
    recordRequestException();
    return Promise.resolve(new Response(null, { status: 500 }));
  });
  const error = new Error(sensitive);
  await assert.rejects(
    () => trace(req, secret, ctx, () => Promise.reject(error)),
    (e: unknown) => e === error,
  );
  await trace(req, undefined, ctx, () => Promise.resolve(response));
  assert.equal(pending.length, 4);
  release();
  await Promise.all(pending);
  const spans = raw.map((body) => {
    assert.ok(
      !body.includes(sensitive) && !body.includes(secret) &&
        !body.includes("hidden"),
    );
    assert.ok(body.length < 32768);
    const spans = JSON.parse(body).resourceSpans[0].scopeSpans[0].spans;
    assert.equal(spans.length, 1);
    return spans[0];
  });
  assert.deepEqual(spans.map((s) => s.status.code), [0, 2, 2, 2]);
  assert.deepEqual(
    spans.map((s) => s.events.map((e: { name: string }) => e.name)),
    [[], [], ["exception"], ["exception"]],
  );
});

Deno.test("Fresh route appears in sanitized request URL even on error; unmatched paths stay private", async () => {
  const { App } = await import("fresh");
  const app = new App();
  app.use((ctx) => {
    recordRequestRoute(ctx.route);
    return ctx.next();
  });
  app.get(
    "/o/:org/invoices/:invoice",
    () => new Response(null, { status: 503 }),
  );
  app.get("/health", () => new Response("ok"));
  const handler = app.handler();
  const spans: {
    name: string;
    attributes: { key: string; value: { stringValue?: string } }[];
  }[] = [];
  const trace = createHttpTracer((_url, init) => {
    const body = String(init?.body);
    assert.ok(!body.includes("private") && !body.includes("session"));
    spans.push(JSON.parse(body).resourceSpans[0].scopeSpans[0].spans[0]);
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const pending: Promise<void>[] = [];
  for (
    const path of [
      "/o/private-org/invoices/private-id",
      "/private@example.test",
      "/health",
    ]
  ) {
    const req = new Request(
      "https://example.test" + path + "?session=private#private",
    );
    await trace(req, "key", {
      waitUntil(p) {
        pending.push(p);
      },
    }, () => handler(req));
  }
  await Promise.all(pending);
  assert.deepEqual(spans.map((s) => s.name), [
    "GET /o/:org/invoices/:invoice",
    "GET",
    "GET /health",
  ]);
  const attr = (i: number, key: string) =>
    spans[i].attributes.find((a) => a.key === key)?.value.stringValue;
  assert.equal(attr(0, "http.route"), "/o/:org/invoices/:invoice");
  assert.equal(
    attr(0, "url.full"),
    "https://example.test/o/:org/invoices/:invoice",
  );
  assert.equal(attr(1, "url.full"), undefined);
  assert.equal(attr(2, "url.full"), "https://example.test/health");
});
