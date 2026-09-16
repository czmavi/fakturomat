import {
  createMigrationDb,
  migrationConnectionConfig,
} from "@/database/migration_client.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("migrations prefer their direct URL and retain the runtime pooler URL", () => {
  const values: Record<string, string> = {
    DATABASE_URL:
      "postgresql://owner:secret@ep-test-pooler.eu-central-1.aws.neon.tech/app",
    DATABASE_MIGRATION_URL:
      "postgresql://owner:secret@ep-test.eu-central-1.aws.neon.tech/app",
  };
  const config = migrationConnectionConfig((name) => values[name]);
  assert(
    config.source === "DATABASE_MIGRATION_URL",
    "Wrong migration URL source",
  );
  assert(
    config.connectionString === values.DATABASE_MIGRATION_URL,
    "Direct URL changed",
  );
  assert(
    values.DATABASE_URL.includes("-pooler"),
    "Runtime URL was overwritten",
  );
  delete values.DATABASE_MIGRATION_URL;
  values.DATABASE_URL = "postgres://owner:secret@localhost:55433/app";
  assert(
    migrationConnectionConfig((name) => values[name]).connectionString ===
      values.DATABASE_URL,
    "Local DATABASE_URL fallback failed",
  );
});

Deno.test("migrations reject missing, malformed and pooled Neon URLs without exposing secrets", () => {
  for (
    const value of [
      undefined,
      "",
      "secret-password",
      "postgres:///app",
      "postgresql://owner:secret-password@db.example.invalid/app?channel_binding=require",
      "https://owner:secret-password@example.test/app",
      "postgresql://owner:secret-password@ep-test-pooler.eu-central-1.aws.neon.tech/app",
    ]
  ) {
    let rejected = false;
    try {
      migrationConnectionConfig((name) =>
        name === "DATABASE_URL" ? value : undefined
      );
    } catch (error) {
      rejected = true;
      assert(
        error instanceof Error && !error.message.includes("secret-password"),
        "Secret leaked in configuration error",
      );
    }
    assert(rejected, "Invalid migration configuration accepted");
  }
});

Deno.test("migration diagnostics report effective destination and timeline without credentials", async () => {
  const environment = {
    DATABASE_MIGRATION_URL:
      "postgresql://private-user:private-password@db.example.invalid:6543/private-database?sslmode=verify-full",
    PGHOST: "127.0.0.1",
    PGPORT: "5432",
    DENO_TIMELINE: "preview/test-revision",
    DENO_DEPLOY_BUILD_ID: "test-revision",
  };
  const previous = new Map(
    Object.keys(environment).map((name) => [name, Deno.env.get(name)]),
  );
  const logs: unknown[][] = [];
  const originalInfo = console.info;
  try {
    for (const [name, value] of Object.entries(environment)) {
      Deno.env.set(name, value);
    }
    console.info = (...args: unknown[]) => {
      logs.push(args);
    };
    const sql = createMigrationDb();
    await sql.end();
    assert(logs.length === 1, "Expected a single destination diagnostic");
    const [message, data] = logs[0];
    assert(message === "Migration database target", "Unexpected log message");
    const target = data as Record<string, unknown>;
    assert(
      JSON.stringify(target.hosts) === '["db.example.invalid"]' &&
        JSON.stringify(target.ports) === "[6543]",
      "Client used PGHOST/PGPORT instead of URL",
    );
    assert(
      target.timeline === environment.DENO_TIMELINE &&
        target.revision === environment.DENO_DEPLOY_BUILD_ID,
      "Missing deploy context",
    );
    for (
      const secret of [
        "private-user",
        "private-password",
        "private-database",
        "postgresql://",
        "sslmode",
      ]
    ) {
      assert(
        !JSON.stringify(logs).includes(secret),
        "Connection secrets leaked to logs",
      );
    }
  } finally {
    console.info = originalInfo;
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("migration URL errors identify input mistakes and missing override without echoing credentials", () => {
  const url = "postgresql://owner:private-password@db.example.invalid/app";
  const cases = [
    [`DATABASE_URL=${url}`, "variable assignment"],
    [`'${url}'`, "starts with a quote"],
    [`psql '${url}'`, "psql command"],
    [
      "https://owner:private-password@db.example.invalid/app",
      "must start with",
    ],
    ["postgresql:///app", "has no hostname"],
    [
      "postgresql://owner:private-password@db.example.invalid:invalid/app",
      "cannot be parsed",
    ],
  ];
  for (const source of ["DATABASE_URL", "DATABASE_MIGRATION_URL"]) {
    for (const [value, expected] of cases) {
      let message = "";
      try {
        migrationConnectionConfig((name) =>
          name === source ? value : undefined
        );
      } catch (error) {
        assert(error instanceof Error, "Expected a configuration error");
        message = error.message;
      }
      assert(
        message.startsWith(`${source}:`) && message.includes(expected),
        "Wrong diagnostic category",
      );
      assert(
        !message.includes("private-password") &&
          !message.includes("db.example.invalid"),
        "Diagnostic leaked input",
      );
      assert(
        message.includes("unset or empty") === (source === "DATABASE_URL"),
        "Wrong migration override diagnostic",
      );
    }
  }
});
