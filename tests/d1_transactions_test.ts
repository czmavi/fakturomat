import { createD1Sql, decimal, money } from "@/database/d1.ts";
import { assert, rejects, testRuntime } from "./d1_test_helper.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { D1InvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";

Deno.test("D1 fixed point rejects precision loss and overflow", async () => {
  assert(decimal(money("900719925474.0991")!) === "900719925474.0991");
  assert(decimal(money("-0.0001")!) === "-0.0001");
  await rejects(() => money("0.00001"));
  await rejects(() => money("900719925474.0992"));
  await rejects(() => decimal(Number.MAX_SAFE_INTEGER + 1));
});
Deno.test("D1 optimistic transaction retries a changed snapshot and never exposes partial writes", async () => {
  const env = testRuntime();
  const sql = createD1Sql(env.DB);
  try {
    await sql`INSERT INTO users(id,email,display_name) VALUES ('u','u@example.test','Before')`;
    let attempts = 0;
    await sql.begin(async (tx) => {
      attempts++;
      const rows = await tx<
        { display_name: string }[]
      >`SELECT display_name FROM users WHERE id='u'`;
      if (attempts === 1) {
        await sql`UPDATE users SET display_name='Concurrent' WHERE id='u'`;
      }
      tx.queue(
        tx`UPDATE users SET display_name=${
          rows[0].display_name + " + committed"
        } WHERE id='u'`,
      );
    });
    assert(attempts === 2);
    assert(
      (await sql<
        { display_name: string }[]
      >`SELECT display_name FROM users WHERE id='u'`)[0].display_name ===
        "Concurrent + committed",
    );
    await rejects(() =>
      sql.begin(async (tx) => {
        await tx`UPDATE users SET display_name='Unsafe immediate write' WHERE id='u'`;
      })
    );
    const org = crypto.randomUUID();
    await new D1OrganizationRepository(sql).createWithOwner({
      id: org,
      ownerUserId: "u",
      type: "SRO",
      officialName: "Firma",
      displayName: "Firma",
    });
    const repo = new D1InvoiceNumberSequenceRepository(sql);
    const sequence = (await repo.listForUser(org, "u"))[0];
    const first = await repo.allocateNextForUser({
      organizationId: org,
      sequenceId: sequence.id,
      userId: "u",
      year: 2026,
    });
    const second = await repo.allocateNextForUser({
      organizationId: org,
      sequenceId: sequence.id,
      userId: "u",
      year: 2026,
    });
    assert(first !== second);
  } finally {
    env.DB.sqlite.close();
  }
});
