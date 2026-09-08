import {
  getOrCreateCsrfToken,
  isValidCsrfToken,
} from "@/services/csrf_service.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("CSRF token is reused only when it has the expected shape", () => {
  const expected = "a".repeat(43);
  const existing = getOrCreateCsrfToken(
    new Request("http://localhost", {
      headers: { cookie: `another=x; fakturomat_csrf=${expected}` },
    }),
  );
  assert(
    existing.token === expected && !existing.created,
    "valid token was not reused",
  );

  const invalid = getOrCreateCsrfToken(
    new Request("http://localhost", {
      headers: { cookie: "fakturomat_csrf=short" },
    }),
  );
  assert(
    invalid.created && invalid.token.length === 43,
    "invalid token was reused",
  );
});

Deno.test("CSRF comparison rejects missing and changed values", () => {
  const token = "a".repeat(43);
  assert(isValidCsrfToken(token, token), "matching token rejected");
  assert(!isValidCsrfToken(token, `${token}x`), "changed token accepted");
  assert(!isValidCsrfToken(token, null), "missing token accepted");
});
