import { runtime } from "@/config/runtime.ts";
import { createD1Sql, type Sql } from "./d1.ts";
export function getDb(): Sql {
  return createD1Sql(runtime().DB);
}
export function closeDb(): Promise<void> {
  return Promise.resolve();
}
