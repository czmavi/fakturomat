import { strict as assert } from "node:assert";
import {
  createHttpTracer,
  recordRequestException,
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
