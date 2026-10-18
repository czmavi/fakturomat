import { DatabaseSync } from "node:sqlite";
import {
  buildImport,
  convertRow,
  sqlLiteral,
} from "@/scripts/export_postgres_to_d1.ts";
import tables from "@/database/schema_tables.json" with { type: "json" };
import { assert, rejects, testRuntime } from "./d1_test_helper.ts";
Deno.test("PostgreSQL export preserves identifiers, hashes, timestamps and SQL quotes", async () => {
  const env = testRuntime();
  const data: Record<string, Record<string, unknown>[]> = {};
  try {
    for (const [table, columns] of Object.entries(tables)) {
      data[table] = env.DB.sqlite.prepare(
        `SELECT ${columns.join(",")} FROM ${table}`,
      ).all() as Record<string, unknown>[];
    }
    for (const rows of Object.values(data)) {
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (key.endsWith("_at") && typeof row[key] === "number") {
            row[key] = new Date(row[key] as number);
          }
        }
      }
    }
    const date = new Date("2026-10-18T00:00:00Z");
    data.users.push({
      id: "owner",
      email: "owner@example.test",
      display_name: "O'Connor",
      is_active: true,
      email_verified: true,
      image: null,
      created_at: date,
      updated_at: date,
    });
    data.auth_accounts.push({
      id: "account",
      account_id: "owner",
      provider_id: "credential",
      user_id: "owner",
      access_token: null,
      refresh_token: null,
      id_token: null,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
      scope: null,
      password: "pbkdf2_sha256$original",
      created_at: date,
      updated_at: date,
    });
    const result = await buildImport(data);
    const target = new DatabaseSync(":memory:");
    try {
      target.exec(result.sql);
      assert(
        target.prepare("SELECT display_name FROM users").get()?.display_name ===
          "O'Connor",
      );
      assert(
        target.prepare("SELECT password FROM auth_accounts").get()?.password ===
          "pbkdf2_sha256$original",
      );
      assert(target.prepare("PRAGMA foreign_key_check").all().length === 0);
    } finally {
      target.close();
    }
    assert(convertRow("invoices", { total: "0.20" }).total === 2000);
    assert(
      sqlLiteral("x'); DROP TABLE users;--") === "'x''); DROP TABLE users;--'",
    );
    await rejects(() =>
      buildImport({ ...data, invoice_documents: [{ id: "existing" }] })
    );
    await rejects(() =>
      buildImport({ ...data, organizations: [{ logo_storage_key: "logo" }] })
    );
    await rejects(() => convertRow("invoices", { total: "900719925474.0992" }));
  } finally {
    env.DB.sqlite.close();
  }
});
