import { closeDb, getDb } from "@/database/client.ts";

const MIGRATION_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_ID = 731_284_091;

interface Migration {
  version: string;
  sql: string;
}

export async function readMigrations(
  directory = new URL("../migrations/", import.meta.url),
): Promise<Migration[]> {
  const migrations: Migration[] = [];

  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile && MIGRATION_PATTERN.test(entry.name)) {
      migrations.push({
        version: entry.name,
        sql: await Deno.readTextFile(new URL(entry.name, directory)),
      });
    }
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}

export async function migrate(): Promise<string[]> {
  const sql = getDb();
  const migrations = await readMigrations();

  return await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
    const [migrationTable] = await transaction<{ exists: boolean }[]>`
      SELECT to_regclass('schema_migrations') IS NOT NULL AS exists
    `;
    if (!migrationTable.exists) {
      await transaction.unsafe(`
        CREATE TABLE schema_migrations (
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    }

    const rows = await transaction<{ version: string }[]>`
      SELECT version FROM schema_migrations
    `;
    const applied = new Set(rows.map((row) => row.version));
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await transaction.unsafe(migration.sql);
      await transaction`
        INSERT INTO schema_migrations (version) VALUES (${migration.version})
      `;
      newlyApplied.push(migration.version);
    }

    return newlyApplied;
  });
}

if (import.meta.main) {
  try {
    const applied = await migrate();
    if (applied.length === 0) {
      console.log("Database is already up to date.");
    } else {
      console.log(`Applied migrations: ${applied.join(", ")}`);
    }
  } finally {
    await closeDb();
  }
}
