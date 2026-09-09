import type { AppEnvironment } from "@/config/env.ts";

export const MAX_REQUEST_CONTENT_LENGTH = 21 * 1024 * 1024;

export function requestContentLengthIsTooLarge(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const raw = request.headers.get("content-length");
  if (raw === null) return false;
  if (!/^[0-9]+$/.test(raw)) return true;
  const length = Number(raw);
  return !Number.isSafeInteger(length) || length > MAX_REQUEST_CONTENT_LENGTH;
}

function contentSecurityPolicy(isTemplatePreview: boolean): string {
  if (isTemplatePreview) {
    return [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
      "img-src data:",
      "object-src 'none'",
      "script-src 'none'",
      "style-src 'unsafe-inline'",
      "sandbox",
    ].join("; ");
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'none'",
  ].join("; ");
}

export function applySecurityHeaders(
  response: Response,
  url: URL,
  environment: AppEnvironment,
): Response {
  const isTemplatePreview = url.pathname.startsWith("/templates/") &&
    url.pathname.endsWith("/preview");
  if (!response.headers.has("Content-Security-Policy")) {
    response.headers.set(
      "Content-Security-Policy",
      contentSecurityPolicy(isTemplatePreview),
    );
  }
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "X-Frame-Options",
    isTemplatePreview ? "SAMEORIGIN" : "DENY",
  );
  if (environment === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return response;
}
