/** Offline migration: reads a repeatable-read PostgreSQL snapshot; never writes to the source. */
import postgres from "postgres";
import { DatabaseSync } from "node:sqlite";
import { money } from "@/database/d1.ts";
import tableColumns from "@/database/schema_tables.json" with { type: "json" };
import monetaryColumns from "@/database/money_columns.json" with {
  type: "json",
};

export function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Unsafe numeric value in source data");
    }
    return String(value);
  }
  if (typeof value !== "string") throw new Error("Unsupported source value");
  if (value.includes("\0")) {
    throw new Error("SQLite text cannot contain a NUL in an SQL import");
  }
  return "'" + value.replaceAll("'", "''") + "'";
}
export function convertRow(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const moneyFields = (monetaryColumns as Record<string, string[]>)[table] ??
    [];
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null) result[column] = null;
    else if (moneyFields.includes(column)) {
      result[column] = money(String(value));
    } else if (column === "last_value" || column === "size") {
      const n = BigInt(String(value));
      if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < 0n) {
        throw new Error(`Unsafe integer: ${table}.${column}`);
      }
      result[column] = Number(n);
    } else if (column.endsWith("_at")) {
      const date = value instanceof Date ? value : new Date(String(value));
      if (!Number.isFinite(date.getTime())) {
        throw new Error(`Invalid timestamp: ${table}.${column}`);
      }
      result[column] = table === "users" || table.startsWith("auth_")
        ? date.toISOString()
        : date.getTime();
    } else if (column.endsWith("_date") || column === "balance_date") {
      result[column] = value instanceof Date
        ? value.toISOString().slice(0, 10)
        : value;
    } else if (typeof value === "object") {
      result[column] = JSON.stringify(value);
    } else result[column] = value;
  }
  return result;
}
export async function buildImport(
  data: Record<string, Record<string, unknown>[]>,
): Promise<{ sql: string; counts: Record<string, number> }> {
  for (const table of ["attachments", "invoice_documents"]) {
    if (data[table]?.length) {
      throw new Error(
        `${table} is not empty. Copy and verify objects in R2 before using a file-aware migration; this exporter refuses to lose file references.`,
      );
    }
  }
  if (data.organizations?.some((row) => row.logo_storage_key !== null)) {
    throw new Error(
      "Organization logos exist; object migration is required first",
    );
  }
  const schema = await Deno.readTextFile(
    new URL("../migrations/d1/0001_schema.sql", import.meta.url),
  );
  const integrity = await Deno.readTextFile(
    new URL("../migrations/d1/0002_integrity.sql", import.meta.url),
  );
  // No default seed rows: copy the source's exact templates instead.
  const seedStart = schema.indexOf("INSERT INTO invoice_templates");
  const seedEnd = schema.indexOf("CREATE TABLE _write_epoch", seedStart);
  if (seedStart < 0 || seedEnd < 0) {
    throw new Error("Unexpected D1 schema layout");
  }
  const statements = [
    schema.slice(0, seedStart) + schema.slice(seedEnd),
    "PRAGMA defer_foreign_keys = ON;",
  ];
  const counts: Record<string, number> = {};
  // Stage nullable template references to avoid cycles even when D1 chunks the import.
  const templateRefs: {
    id: unknown;
    current: unknown;
    organization: unknown;
    source: unknown;
  }[] = [];
  const order = [
    "users",
    "invoice_templates",
    "invoice_template_versions",
    "organizations",
    "organization_memberships",
    "bank_accounts",
    "contacts",
    "invoice_number_sequences",
    "invoice_number_counters",
    "invoices",
    "invoice_items",
    "invoice_documents",
    "expense_categories",
    "expenses",
    "expense_vat_lines",
    "attachments",
    "bank_connections",
    "bank_transactions",
    "invoice_payments",
    "expense_payments",
    "auth_accounts",
    "auth_sessions",
    "auth_verifications",
  ];
  // Organizations can refer to their own templates; defer FK checks for this cycle.
  for (const table of order) {
    const rows = data[table];
    if (!rows) throw new Error(`Missing source table ${table}`);
    counts[table] = rows.length;
    for (const raw of rows) {
      const row = convertRow(table, raw);
      if (table === "invoice_templates") {
        templateRefs.push({
          id: row.id,
          current: row.current_version_id,
          organization: row.organization_id,
          source: row.source_template_id,
        });
        row.current_version_id = null;
        row.organization_id = null;
        row.source_template_id = null;
      }
      const columns = Object.keys(row);
      statements.push(
        `INSERT INTO "${table}" (${
          columns.map((c) => `"${c}"`).join(",")
        }) VALUES (${columns.map((c) => sqlLiteral(row[c])).join(",")});`,
      );
    }
  }
  for (const row of templateRefs) {
    statements.push(
      `UPDATE invoice_templates SET current_version_id = ${
        sqlLiteral(row.current)
      }, organization_id = ${
        sqlLiteral(row.organization)
      }, source_template_id = ${sqlLiteral(row.source)} WHERE id = ${
        sqlLiteral(row.id)
      };`,
    );
  }
  statements.push(integrity);
  statements.push(
    await Deno.readTextFile(
      new URL("../migrations/d1/0003_expense_details.sql", import.meta.url),
    ),
  );
  statements.push(
    "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
    "INSERT INTO d1_migrations(name) VALUES ('0001_schema.sql'), ('0002_integrity.sql'), ('0003_expense_details.sql');",
  );
  statements.push(
    "CREATE TABLE _import_checks (valid INTEGER CHECK (valid = 1));",
  );
  for (const [table, count] of Object.entries(counts)) {
    statements.push(
      `INSERT INTO _import_checks SELECT CASE WHEN count(*) = ${count} THEN 1 ELSE 0 END FROM "${table}";`,
    );
  }
  statements.push(
    "INSERT INTO _import_checks SELECT CASE WHEN count(*) = 0 THEN 1 ELSE 0 END FROM pragma_foreign_key_check;",
    "DROP TABLE _import_checks;",
    "PRAGMA defer_foreign_keys = OFF;",
  );
  const script = statements.join("\n\n") + "\n";
  const validation = new DatabaseSync(":memory:");
  try {
    validation.exec("BEGIN");
    validation.exec(script);
    validation.exec("COMMIT");
    if (validation.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("Foreign key validation failed");
    }
  } finally {
    validation.close();
  }
  return { sql: script, counts };
}

if (import.meta.main) {
  const index = Deno.args.indexOf("--output");
  const output = index < 0 ? undefined : Deno.args[index + 1];
  const url = Deno.env.get("SOURCE_DATABASE_URL");
  if (!output || !url) {
    throw new Error(
      "Usage: SOURCE_DATABASE_URL=... deno task data:export --output /secure/path/import.sql",
    );
  }
  const source = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const data = await source.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const result: Record<string, Record<string, unknown>[]> = {};
        for (const [table, columns] of Object.entries(tableColumns)) {
          // Read all columns and fail on schema drift, rather than silently dropping newer fields.
          const actual = await tx<
            { column_name: string }[]
          >`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`;
          if (
            actual.length !== columns.length ||
            actual.some((r) => !columns.includes(r.column_name))
          ) {
            throw new Error(
              `Source schema differs for ${table}; update the migration before continuing`,
            );
          }
          result[table] = await tx.unsafe(
            `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${table}"`,
          );
        }
        return result;
      },
    );
    const result = await buildImport(
      data as Record<string, Record<string, unknown>[]>,
    );
    // SQL contains password hashes, active sessions and encrypted bank credentials.
    const file = await Deno.open(output, {
      write: true,
      createNew: true,
      mode: 0o600,
    });
    try {
      const bytes = new TextEncoder().encode(result.sql);
      let offset = 0;
      while (offset < bytes.length) {
        offset += await file.write(bytes.subarray(offset));
      }
    } finally {
      file.close();
    }
    console.log(
      JSON.stringify(
        {
          output,
          tables: result.counts,
          status:
            "Validated locally; import into a NEW empty D1 database while source writes are stopped.",
        },
        null,
        2,
      ),
    );
  } finally {
    await source.end();
  }
}
