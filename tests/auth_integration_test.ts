import { closeDb, getDb } from "@/database/client.ts";
import { migrate } from "@/database/migrate.ts";
import { hashPassword } from "@/domain/auth/password.ts";
import { PostgresAuthRepository } from "@/repositories/auth_repository.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import { PostgresOrganizationRepository } from "@/repositories/organization_repository.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { AuthService } from "@/services/auth_service.ts";

const testDatabaseUrl = Deno.env.get("TEST_DATABASE_URL");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test({
  name: "auth integration: user can log in and revoked session is rejected",
  ignore: testDatabaseUrl === undefined,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    Deno.env.set("DATABASE_URL", testDatabaseUrl!);
    await migrate();

    const sql = getDb();
    const repository = new PostgresAuthRepository(sql);
    const service = new AuthService(repository);
    const userId = crypto.randomUUID();
    const email = `auth-${userId}@example.test`;

    try {
      await repository.createUser({
        id: userId,
        email,
        displayName: "Integration Test",
        passwordHash: await hashPassword("integration-password", 10_000),
      });

      const session = await service.authenticate(email, "integration-password");
      assert(session !== null, "login failed");
      assert(
        session.token.length === 43,
        "raw session token has an unexpected shape",
      );

      const currentUser = await repository.findSessionUser(session.tokenHash);
      assert(
        currentUser?.id === userId,
        "active session did not resolve its user",
      );

      await repository.revokeSession(session.tokenHash);
      const revokedUser = await repository.findSessionUser(session.tokenHash);
      assert(revokedUser === null, "revoked session remained valid");
    } finally {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await closeDb();
    }
  },
});

Deno.test({
  name: "contact integration: CRUD, search, archive and tenant isolation",
  ignore: testDatabaseUrl === undefined,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    Deno.env.set("DATABASE_URL", testDatabaseUrl!);
    await migrate();

    const sql = getDb();
    const authRepository = new PostgresAuthRepository(sql);
    const organizationRepository = new PostgresOrganizationRepository(sql);
    const contactRepository = new PostgresContactRepository(sql);
    const ownerId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const passwordHash = await hashPassword("integration-password", 10_000);

    try {
      await authRepository.createUser({
        id: ownerId,
        email: `contact-owner-${ownerId}@example.test`,
        displayName: "Contact owner",
        passwordHash,
      });
      await authRepository.createUser({
        id: outsiderId,
        email: `contact-outsider-${outsiderId}@example.test`,
        displayName: "Contact outsider",
        passwordHash,
      });
      await organizationRepository.createWithOwner({
        id: organizationId,
        type: "SRO",
        officialName: "Contact Test s.r.o.",
        displayName: "Contact Test",
        ownerUserId: ownerId,
      });
      await organizationRepository.createWithOwner({
        id: otherOrganizationId,
        type: "OSVC",
        officialName: "Other Contact Test",
        displayName: "Other Contact Test",
        ownerUserId: ownerId,
      });

      const created = await contactRepository.createForUser({
        id: contactId,
        organizationId,
        userId: ownerId,
        type: "COMPANY",
        name: "Acme Integration s.r.o.",
        ico: "12345678",
        dic: "CZ12345678",
        street: "Testovací 1",
        city: "Praha",
        postalCode: "110 00",
        country: "CZ",
        email: "billing@acme.example",
        phone: null,
        defaultDueDays: 30,
        note: null,
      });
      assert(created?.id === contactId, "owner could not create contact");

      const found = await contactRepository.listForUser({
        organizationId,
        userId: ownerId,
        search: "acme",
        includeArchived: false,
      });
      assert(
        found.length === 1 && found[0].id === contactId,
        "contact search failed",
      );
      const literalWildcard = await contactRepository.listForUser({
        organizationId,
        userId: ownerId,
        search: "%",
        includeArchived: false,
      });
      assert(literalWildcard.length === 0, "search wildcard was not escaped");

      const otherOrganizationContacts = await contactRepository.listForUser({
        organizationId: otherOrganizationId,
        userId: ownerId,
        search: "",
        includeArchived: true,
      });
      assert(
        otherOrganizationContacts.length === 0,
        "contact leaked into another organization",
      );
      assert(
        await contactRepository.findForUser(
          organizationId,
          contactId,
          outsiderId,
        ) === null,
        "outsider loaded contact without membership",
      );
      assert(
        await contactRepository.createForUser({
          id: crypto.randomUUID(),
          organizationId,
          userId: outsiderId,
          type: "PERSON",
          name: "Unauthorized contact",
          ico: null,
          dic: null,
          street: null,
          city: null,
          postalCode: null,
          country: "CZ",
          email: null,
          phone: null,
          defaultDueDays: null,
          note: null,
        }) === null,
        "outsider created contact without membership",
      );

      const updated = await contactRepository.updateForUser({
        id: contactId,
        organizationId,
        userId: ownerId,
        type: "COMPANY",
        name: "Acme Updated s.r.o.",
        ico: "12345678",
        dic: "CZ12345678",
        street: "Nová 2",
        city: "Brno",
        postalCode: "602 00",
        country: "CZ",
        email: "billing@acme.example",
        phone: null,
        defaultDueDays: 14,
        note: "Updated",
      });
      assert(updated?.city === "Brno", "owner could not update contact");
      assert(
        await contactRepository.updateForUser({
          id: contactId,
          organizationId,
          userId: outsiderId,
          type: "PERSON",
          name: "Hijacked",
          ico: null,
          dic: null,
          street: null,
          city: null,
          postalCode: null,
          country: "CZ",
          email: null,
          phone: null,
          defaultDueDays: null,
          note: null,
        }) === null,
        "outsider updated contact without membership",
      );
      assert(
        !await contactRepository.archiveForUser(
          organizationId,
          contactId,
          outsiderId,
        ),
        "outsider archived contact without membership",
      );
      assert(
        await contactRepository.archiveForUser(
          organizationId,
          contactId,
          ownerId,
        ),
        "owner could not archive contact",
      );
      const activeAfterArchive = await contactRepository.listForUser({
        organizationId,
        userId: ownerId,
        search: "",
        includeArchived: false,
      });
      assert(
        activeAfterArchive.length === 0,
        "archived contact remained in active list",
      );
      const archivedContacts = await contactRepository.listForUser({
        organizationId,
        userId: ownerId,
        search: "",
        includeArchived: true,
      });
      assert(
        archivedContacts[0]?.archivedAt instanceof Date,
        "archived contact is unavailable",
      );
    } finally {
      await sql`DELETE FROM organizations WHERE id IN (${organizationId}, ${otherOrganizationId})`;
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${outsiderId})`;
      await closeDb();
    }
  },
});

Deno.test({
  name: "organization integration: membership enforces tenant isolation",
  ignore: testDatabaseUrl === undefined,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    Deno.env.set("DATABASE_URL", testDatabaseUrl!);
    await migrate();

    const sql = getDb();
    const authRepository = new PostgresAuthRepository(sql);
    const organizationRepository = new PostgresOrganizationRepository(sql);
    const settingsRepository = new PostgresOrganizationSettingsRepository(sql);
    const bankAccountRepository = new PostgresBankAccountRepository(sql);
    const ownerId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const passwordHash = await hashPassword("integration-password", 10_000);

    try {
      await authRepository.createUser({
        id: ownerId,
        email: `owner-${ownerId}@example.test`,
        displayName: "Owner",
        passwordHash,
      });
      await authRepository.createUser({
        id: outsiderId,
        email: `outsider-${outsiderId}@example.test`,
        displayName: "Outsider",
        passwordHash,
      });
      await organizationRepository.createWithOwner({
        id: organizationId,
        type: "SRO",
        officialName: "Isolation Test s.r.o.",
        displayName: "Isolation Test",
        ownerUserId: ownerId,
      });

      const ownerOrganization = await organizationRepository.findForUser(
        organizationId,
        ownerId,
      );
      assert(
        ownerOrganization?.id === organizationId,
        "owner cannot load organization",
      );

      const outsiderOrganization = await organizationRepository.findForUser(
        organizationId,
        outsiderId,
      );
      assert(
        outsiderOrganization === null,
        "outsider loaded organization without membership",
      );

      const outsiderOrganizations = await organizationRepository.listForUser(
        outsiderId,
      );
      assert(
        outsiderOrganizations.length === 0,
        "outsider organization list leaked data",
      );

      const ownerSettings = await settingsRepository.findForUser(
        organizationId,
        ownerId,
      );
      assert(ownerSettings !== null, "owner cannot load organization settings");
      assert(
        await settingsRepository.findForUser(organizationId, outsiderId) ===
          null,
        "outsider loaded organization settings",
      );
      const outsiderUpdate = await settingsRepository.updateForUser({
        ...ownerSettings,
        displayName: "Unauthorized change",
        userId: outsiderId,
      });
      assert(!outsiderUpdate, "outsider updated organization settings");

      const firstAccount = await bankAccountRepository.createForUser({
        id: crypto.randomUUID(),
        organizationId,
        userId: ownerId,
        name: "Main account",
        bankName: "Test bank",
        accountPrefix: null,
        accountNumber: "123456789",
        bankCode: "0100",
        iban: null,
        bic: null,
        currency: "CZK",
        isDefault: false,
        isActive: true,
      });
      assert(
        firstAccount?.isDefault === true,
        "first active bank account was not made default",
      );

      const secondAccount = await bankAccountRepository.createForUser({
        id: crypto.randomUUID(),
        organizationId,
        userId: ownerId,
        name: "Euro account",
        bankName: null,
        accountPrefix: null,
        accountNumber: null,
        bankCode: null,
        iban: "DE89370400440532013000",
        bic: null,
        currency: "EUR",
        isDefault: true,
        isActive: true,
      });
      assert(
        secondAccount?.isDefault === true,
        "selected bank account was not made default",
      );
      const ownerAccounts = await bankAccountRepository.listForUser(
        organizationId,
        ownerId,
      );
      assert(
        ownerAccounts.filter((account) => account.isDefault).length === 1,
        "organization has multiple default accounts",
      );
      assert(
        ownerAccounts.find((account) => account.id === firstAccount?.id)
          ?.isDefault === false,
        "previous default account remained default",
      );
      assert(
        await bankAccountRepository.findForUser(
          organizationId,
          secondAccount!.id,
          outsiderId,
        ) === null,
        "outsider loaded a bank account",
      );
      assert(
        await bankAccountRepository.updateForUser({
          id: secondAccount!.id,
          organizationId,
          userId: outsiderId,
          name: "Unauthorized edit",
          bankName: null,
          accountPrefix: null,
          accountNumber: null,
          bankCode: null,
          iban: "DE89370400440532013000",
          bic: null,
          currency: "EUR",
          isDefault: true,
          isActive: true,
        }) === null,
        "outsider updated a bank account",
      );
      assert(
        await bankAccountRepository.createForUser({
          id: crypto.randomUUID(),
          organizationId,
          userId: outsiderId,
          name: "Unauthorized account",
          bankName: null,
          accountPrefix: null,
          accountNumber: "987654321",
          bankCode: "0300",
          iban: null,
          bic: null,
          currency: "CZK",
          isDefault: false,
          isActive: true,
        }) === null,
        "outsider created a bank account",
      );

      const changedDefault = await bankAccountRepository.updateForUser({
        id: firstAccount!.id,
        organizationId,
        userId: ownerId,
        name: firstAccount!.name,
        bankName: firstAccount!.bankName,
        accountPrefix: firstAccount!.accountPrefix,
        accountNumber: firstAccount!.accountNumber,
        bankCode: firstAccount!.bankCode,
        iban: firstAccount!.iban,
        bic: firstAccount!.bic,
        currency: firstAccount!.currency,
        isDefault: true,
        isActive: true,
      });
      assert(
        changedDefault?.isDefault === true,
        "default account could not be changed",
      );

      await bankAccountRepository.updateForUser({
        id: firstAccount!.id,
        organizationId,
        userId: ownerId,
        name: firstAccount!.name,
        bankName: firstAccount!.bankName,
        accountPrefix: firstAccount!.accountPrefix,
        accountNumber: firstAccount!.accountNumber,
        bankCode: firstAccount!.bankCode,
        iban: firstAccount!.iban,
        bic: firstAccount!.bic,
        currency: firstAccount!.currency,
        isDefault: false,
        isActive: false,
      });
      const accountsAfterDeactivation = await bankAccountRepository.listForUser(
        organizationId,
        ownerId,
      );
      assert(
        accountsAfterDeactivation.find((account) =>
          account.id === secondAccount!.id
        )?.isDefault === true,
        "deactivating the default account did not promote another active account",
      );
    } finally {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${outsiderId})`;
      await closeDb();
    }
  },
});
