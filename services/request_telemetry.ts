import { AsyncLocalStorage } from "node:async_hooks";

const endpoint = "https://controlpanel.caretsix.com/v1/traces";
const current = new AsyncLocalStorage<{ exception: boolean }>();
const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);
const nano = (ms: number) => String(ms) + "000000";
function id(bytes: number) {
  return crypto.getRandomValues(new Uint8Array(bytes)).toHex();
}

// Fresh may render a thrown exception into an HTTP response inside server.fetch.
export function recordRequestException() {
  const state = current.getStore();
  if (state) state.exception = true;
}

// No cross-request queue: Workers I/O belongs to the originating request.
// Send one bounded span, never a URL, arbitrary method, error text, stack or headers.
export function createHttpTracer(send: typeof fetch = fetch) {
  let times: number[] = [], blockedUntil = 0;
  async function exportSpan(
    key: string,
    method: string,
    start: number,
    status: number | undefined,
    exception: boolean,
  ) {
    const now = Date.now();
    if (now < blockedUntil) return;
    times = times.filter((time) => time > now - 60000);
    if (times.length >= 2000) return;
    times.push(now);
    const end = nano(Math.max(start, now));
    const attributes: {
      key: string;
      value: { stringValue: string } | { intValue: string };
    }[] = [
      { key: "http.request.method", value: { stringValue: method } },
    ];
    if (status !== undefined) {
      attributes.push({
        key: "http.response.status_code",
        value: { intValue: String(status) },
      });
    }
    const span = {
      traceId: id(16),
      spanId: id(8),
      name: method,
      kind: 2,
      startTimeUnixNano: nano(start),
      endTimeUnixNano: end,
      attributes,
      status: {
        code: exception || (status !== undefined && status >= 400) ? 2 : 0,
      },
      events: exception
        ? [{
          name: "exception",
          timeUnixNano: end,
          attributes: [{
            key: "exception.type",
            value: { stringValue: "Error" },
          }],
        }]
        : [],
    };
    const response = await send(endpoint, {
      method: "POST",
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(3000),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        resourceSpans: [{
          resource: {
            attributes: [{
              key: "service.name",
              value: { stringValue: "fakturomat" },
            }],
          },
          scopeSpans: [{ scope: { name: "fakturomat.http" }, spans: [span] }],
        }],
      }),
    });
    if (response.status === 429) {
      blockedUntil = Date.now() +
        Math.max(60, Number(response.headers.get("retry-after")) || 0) * 1000;
    }
    await response.body?.cancel();
  }
  return async function trace(
    request: Request,
    key: unknown,
    ctx: { waitUntil(promise: Promise<void>): void },
    handle: () => Promise<Response>,
  ) {
    if (typeof key !== "string" || !key) return handle();
    const start = Date.now(), state = { exception: false };
    let status: number | undefined;
    try {
      const response = await current.run(state, handle);
      status = response.status;
      return response;
    } catch (error) {
      state.exception = true;
      throw error;
    } finally {
      const method = methods.has(request.method) ? request.method : "_OTHER";
      ctx.waitUntil(
        exportSpan(key, method, start, status, state.exception).catch(() => {}),
      );
    }
  };
}
export const traceHttp = createHttpTracer();
