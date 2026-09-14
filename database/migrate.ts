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
  const connection = await sql.reserve();

  try {
    await connection`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    const [migrationTable] = await connection<{ exists: boolean }[]>`
      SELECT to_regclass('schema_migrations') IS NOT NULL AS exists
    `;
    if (!migrationTable.exists) {
      await connection.unsafe(`
        CREATE TABLE schema_migrations (
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    }

    const rows = await connection<{ version: string }[]>`
      SELECT version FROM schema_migrations
    `;
    const applied = new Set(rows.map((row) => row.version));
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await connection.unsafe("BEGIN");
      try {
        await connection.unsafe(migration.sql);
        await connection`
          INSERT INTO schema_migrations (version) VALUES (${migration.version})
        `;
        await connection.unsafe("COMMIT");
      } catch (error) {
        await connection.unsafe("ROLLBACK");
        throw error;
      }
      newlyApplied.push(migration.version);
    }

    return newlyApplied;
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    } finally {
      connection.release();
    }
  }
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
