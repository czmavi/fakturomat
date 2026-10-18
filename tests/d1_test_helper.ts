import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  D1Database,
  D1Result,
  D1Statement,
  R2Bucket,
  RuntimeEnv,
} from "@/config/runtime.ts";
export class TestD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    for (const file of ["0001_schema.sql", "0002_integrity.sql"]) {
      this.sqlite.exec(
        Deno.readTextFileSync(
          new URL(`../migrations/d1/${file}`, import.meta.url),
        ),
      );
    }
  }
  prepare(query: string): D1Statement {
    const db = this.sqlite;
    let params: SQLInputValue[] = [];
    const all = <T>(): Promise<D1Result<T>> => {
      const stmt = db.prepare(query);
      const results = stmt.all(...params) as T[];
      return Promise.resolve({
        results,
        success: true,
        meta: {
          changes: Number(
            (db.prepare("SELECT changes() AS n").get() as { n: number }).n,
          ),
        },
      });
    };
    const statement: D1Statement = {
      bind(...values: unknown[]) {
        params = values as SQLInputValue[];
        return statement;
      },
      all,
      async first<T>() {
        return (await all<T>()).results[0] ?? null;
      },
      run: () => all(),
      async raw<T>() {
        return (await all<Record<string, unknown>>()).results.map(
          Object.values,
        ) as T[];
      },
    };
    return statement;
  }
  async batch<T>(statements: D1Statement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) results.push(await stmt.all<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  exec(query: string): Promise<unknown> {
    this.sqlite.exec(query);
    return Promise.resolve({ count: 1, duration: 0 });
  }
}
export class TestR2 implements R2Bucket {
  readonly objects = new Map<string, Uint8Array>();
  put(
    key: string,
    value: Uint8Array,
    options?: { onlyIf?: { etagDoesNotMatch: string } },
  ) {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return Promise.resolve(null);
    }
    this.objects.set(key, value.slice());
    return Promise.resolve({ etag: "test-etag" });
  }
  get(key: string) {
    const bytes = this.objects.get(key);
    return Promise.resolve(
      bytes
        ? { arrayBuffer: () => Promise.resolve(bytes.slice().buffer) }
        : null,
    );
  }
  delete(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
export function testRuntime(): RuntimeEnv & {
  DB: TestD1;
  DOCUMENTS: TestR2;
  FILES: TestR2;
} {
  return {
    DB: new TestD1(),
    DOCUMENTS: new TestR2(),
    FILES: new TestR2(),
    APP_ENV: "test",
    BETTER_AUTH_URL: "http://fakturomat.test",
    BETTER_AUTH_SECRET: "fakturomat-test-secret-at-least-32-characters",
    BANK_CREDENTIALS_ENCRYPTION_KEY: btoa("a".repeat(32)),
  };
}
export function assert(
  value: unknown,
  message = "Assertion failed",
): asserts value {
  if (!value) throw new Error(message);
}
export async function rejects(callback: () => unknown | Promise<unknown>) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error("Expected rejection");
}
