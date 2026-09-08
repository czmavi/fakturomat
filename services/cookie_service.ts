import { getAppEnvironment } from "@/config/env.ts";

export interface CookieOptions {
  httpOnly?: boolean;
  maxAge?: number;
  sameSite?: "Lax" | "Strict";
}

export function getCookie(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export function createCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (getAppEnvironment() === "production") parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}
