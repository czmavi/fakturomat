import { App } from "fresh";
import { applySecurityHeaders } from "@/services/security_headers.ts";

function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("CSP authorizes Fresh-rendered scripts with a fresh nonce per response", async () => {
  const app = new App();
  app.use(async (ctx) =>
    applySecurityHeaders(await ctx.next(), ctx.url, "production")
  );
  app.get("/", (ctx) =>
    ctx.render(
      <html>
        <head />
        <body>
          <script type="module">globalThis.example = true;</script>
        </body>
      </html>,
    ));
  const handler = app.handler();
  const nonces = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const response = await handler(new Request("https://fakturomat.test/"));
    const html = await response.text();
    assert(response.status === 200, html);
    const nonce = html.match(/<script[^>]*nonce="([a-f0-9]{32})"/)?.[1];
    assert(
      Boolean(nonce),
      "Fresh did not attach a nonce to its rendered script",
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    assert(
      csp.includes(`script-src 'self' 'nonce-${nonce}'`),
      "CSP blocks renderer nonce",
    );
    assert(
      !csp.includes("unsafe-inline"),
      "CSP permits arbitrary inline scripts",
    );
    nonces.add(nonce!);
  }
  assert(nonces.size === 2, "nonce reused across responses");
});
