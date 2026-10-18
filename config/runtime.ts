import { AsyncLocalStorage } from "node:async_hooks";

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number };
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  raw<T = unknown[]>(): Promise<T[]>;
}
export interface D1Database {
  prepare(query: string): D1Statement;
  batch<T = Record<string, unknown>>(
    statements: D1Statement[],
  ): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}
export interface R2Bucket {
  put(
    key: string,
    value: Uint8Array,
    options?: {
      onlyIf?: { etagDoesNotMatch: string };
      httpMetadata?: { contentType: string };
    },
  ): Promise<{ etag: string } | null>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}
export interface RuntimeEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  FILES: R2Bucket;
  [key: string]: unknown;
}
const context = new AsyncLocalStorage<RuntimeEnv>();
export function withRuntime<T>(env: RuntimeEnv, callback: () => T): T {
  return context.run(env, callback);
}
export function runtime(): RuntimeEnv {
  const env = context.getStore();
  if (!env) throw new Error("Cloudflare runtime bindings are unavailable");
  return env;
}
export function envValue(name: string): string | undefined {
  const value = context.getStore()?.[name];
  if (typeof value === "string") return value;
  return typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
}
