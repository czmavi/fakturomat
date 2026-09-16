import postgres, { type Sql } from "postgres";

export function migrationConnectionConfig(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): { connectionString: string; source: string } {
  const source = env("DATABASE_MIGRATION_URL")?.trim()
    ? "DATABASE_MIGRATION_URL"
    : "DATABASE_URL";
  const connectionString = env(source)?.trim();
  if (!connectionString) {
    throw new Error(
      "Migrations require DATABASE_MIGRATION_URL or DATABASE_URL.",
    );
  }
  let url: URL;
  try {
    url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
      throw new Error();
    }
  } catch {
    // A URL parser error can contain the password. Do not include its cause.
    throw new Error(
      `${source} must be a PostgreSQL URL with an explicit hostname.`,
    );
  }
  if (
    url.hostname.endsWith(".neon.tech") &&
    url.hostname.split(".")[0].endsWith("-pooler")
  ) {
    throw new Error(
      "Migrations require a direct Neon connection for session advisory locks. Set DATABASE_MIGRATION_URL to the connection string copied with Connection pooling disabled.",
    );
  }
  if (url.searchParams.has("channel_binding")) {
    throw new Error(
      `${source}: postgres.js does not support channel_binding. Use a PostgreSQL client-compatible URL, for example sslmode=verify-full without the libpq-only channel_binding parameter.`,
    );
  }
  return { connectionString, source };
}

export function createMigrationDb(): Sql {
  const { connectionString, source } = migrationConnectionConfig();
  const sql = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  // Inspect the driver's parsed destination, not the raw URL or credentials.
  console.info("Migration database target", {
    source,
    hosts: sql.options.host,
    ports: sql.options.port,
    timeline: Deno.env.get("DENO_TIMELINE") ?? "local",
    revision: Deno.env.get("DENO_DEPLOY_BUILD_ID") ?? null,
  });
  return sql;
}
