import postgres, { type Sql } from "postgres";
import { getDatabaseMaxConnections, requireDatabaseUrl } from "@/config/env.ts";

let client: Sql | undefined;

export function getDb(): Sql {
  if (client === undefined) {
    client = postgres(requireDatabaseUrl(), {
      max: getDatabaseMaxConnections(),
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client !== undefined) {
    const current = client;
    client = undefined;
    await current.end({ timeout: 5 });
  }
}
