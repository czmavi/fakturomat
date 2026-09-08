import { timingSafeEqual } from "@/domain/auth/password.ts";
import { createCookie, getCookie } from "@/services/cookie_service.ts";

export const CSRF_COOKIE_NAME = "fakturomat_csrf";

function createToken(): string {
  return crypto.getRandomValues(new Uint8Array(32)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
}

export function getOrCreateCsrfToken(request: Request): {
  token: string;
  created: boolean;
} {
  const token = getCookie(request.headers, CSRF_COOKIE_NAME);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { token, created: false };
  }
  return { token: createToken(), created: true };
}

export function createCsrfCookie(name: string, token: string): string {
  return createCookie(name, token, { sameSite: "Strict" });
}

export function isValidCsrfToken(
  expected: string,
  submitted: unknown,
): boolean {
  if (typeof submitted !== "string") return false;
  const encoder = new TextEncoder();
  return timingSafeEqual(encoder.encode(expected), encoder.encode(submitted));
}
