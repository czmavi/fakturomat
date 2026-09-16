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
  const invalid = (reason: string): never => {
    const fallback = source === "DATABASE_URL"
      ? " DATABASE_MIGRATION_URL is unset or empty in this process."
      : "";
    // Only fixed explanations are included; never echo any part of the input.
    throw new Error(`${source}: ${reason}${fallback}`);
  };
  if (
    /^(?:export\s+)?DATABASE_(?:MIGRATION_)?URL\s*=/i.test(connectionString)
  ) {
    invalid(
      "the value contains a variable assignment; enter only the PostgreSQL URL in the Value field.",
    );
  }
  if (/^["'`]/.test(connectionString)) {
    invalid(
      "the value starts with a quote; remove surrounding quotes from the Value field.",
    );
  }
  if (/^psql\s/i.test(connectionString)) {
    invalid(
      "the value is a psql command; copy only its PostgreSQL connection URL.",
    );
  }
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    invalid("the value must start with postgres:// or postgresql://.");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // A URL parser error can contain the password. Do not include its cause.
    return invalid(
      "the PostgreSQL URL cannot be parsed; copy a valid connection URL and percent-encode reserved characters in credentials.",
    );
  }
  if (!url.hostname) {
    invalid(
      "the PostgreSQL URL has no hostname; an explicit database hostname is required.",
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
