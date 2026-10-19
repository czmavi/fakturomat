import { withRuntime } from "@/config/runtime.ts";
import { getDb } from "@/database/client.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { OrganizationService } from "@/services/organization_service.ts";
import { assert, rejects, testRuntime } from "./d1_test_helper.ts";

Deno.test("new organization persists billing details atomically and validates them", async () => {
  const env = testRuntime();
  try {
    await withRuntime(env, async () => {
      const sql = getDb();
      const userId = crypto.randomUUID();
      await sql`INSERT INTO users(id,email,display_name,email_verified) VALUES (${userId}, 'ares@example.test', 'Owner', true)`;
      const service = new OrganizationService(new D1OrganizationRepository());
      const input = {
        type: "SRO",
        officialName: "Test s.r.o.",
        displayName: "Test",
        ownerUserId: userId,
        ico: "00123456",
        dic: "cz00123456",
        street: " Dlouhá 12/3a ",
        city: "Praha",
        postalCode: "11000",
        country: "cz",
      };
      const organization = await service.create(input);
      const [stored] =
        await sql`SELECT ico, dic, street, city, postal_code, country FROM organizations WHERE id = ${organization.id}`;
      assert(stored.ico === "00123456" && stored.dic === "CZ00123456");
      assert(stored.street === "Dlouhá 12/3a" && stored.city === "Praha");
      assert(stored.postal_code === "11000" && stored.country === "CZ");
      for (
        const invalid of [{ ico: "123" }, { dic: "???" }, { country: "" }, {
          street: "x".repeat(201),
        }]
      ) {
        await rejects(() => service.create({ ...input, ...invalid }));
      }
      const [count] =
        await sql`SELECT count(*) AS total_count FROM organizations`;
      assert(count.total_count === 1, "invalid input created an organization");
    });
  } finally {
    env.DB.sqlite.close();
  }
});
