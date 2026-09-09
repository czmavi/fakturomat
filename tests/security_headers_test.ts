import {
  applySecurityHeaders,
  MAX_REQUEST_CONTENT_LENGTH,
  requestContentLengthIsTooLarge,
} from "@/services/security_headers.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("security headers harden regular dynamic responses", () => {
  const response = applySecurityHeaders(
    new Response("page"),
    new URL("https://fakturomat.example/o/id/dashboard"),
    "production",
  );
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  assert(csp.includes("frame-ancestors 'none'"), "framing was not denied");
  assert(csp.includes("worker-src 'none'"), "workers were not denied");
  assert(
    response.headers.get("Cache-Control") === "private, no-store",
    "authenticated response can be cached",
  );
  assert(
    response.headers.has("Strict-Transport-Security"),
    "production response has no HSTS",
  );
  assert(
    response.headers.get("Cross-Origin-Resource-Policy") === "same-origin",
    "cross-origin resource isolation is missing",
  );
});

Deno.test("preview CSP permits only inline CSS and preserves stricter CSP", () => {
  const preview = applySecurityHeaders(
    new Response("preview"),
    new URL(
      "https://fakturomat.example/templates/template/versions/version/preview",
    ),
    "development",
  );
  const previewCsp = preview.headers.get("Content-Security-Policy") ?? "";
  assert(
    previewCsp.includes("style-src 'unsafe-inline'") &&
      previewCsp.includes("script-src 'none'") &&
      previewCsp.includes("sandbox"),
    "preview policy is not isolated",
  );
  assert(
    preview.headers.get("X-Frame-Options") === "SAMEORIGIN",
    "same-origin preview cannot be framed",
  );

  const download = applySecurityHeaders(
    new Response("file", {
      headers: {
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
      },
    }),
    new URL("https://fakturomat.example/file.pdf"),
    "development",
  );
  assert(
    download.headers.get("Content-Security-Policy") ===
      "sandbox; default-src 'none'",
    "stricter download CSP was overwritten",
  );
});

Deno.test("declared oversized request bodies are rejected early", () => {
  assert(
    requestContentLengthIsTooLarge(
      new Request("https://fakturomat.example/upload", {
        method: "POST",
        headers: {
          "content-length": String(MAX_REQUEST_CONTENT_LENGTH + 1),
        },
        body: "x",
      }),
    ),
    "oversized declared body was accepted",
  );
  assert(
    !requestContentLengthIsTooLarge(
      new Request("https://fakturomat.example/upload", {
        method: "POST",
        headers: { "content-length": "1024" },
        body: "x",
      }),
    ),
    "small declared body was rejected",
  );
});
