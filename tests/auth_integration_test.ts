import { closeDb, getDb } from "@/database/client.ts";
import { migrate } from "@/database/migrate.ts";
import { hashPassword } from "@/domain/auth/password.ts";
import { PostgresAuthRepository } from "@/repositories/auth_repository.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresBankConnectionRepository } from "@/repositories/bank_connection_repository.ts";
import { PostgresBankTransactionRepository } from "@/repositories/bank_transaction_repository.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import { PostgresDashboardRepository } from "@/repositories/dashboard_repository.ts";
import { PostgresExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";
import { PostgresExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { PostgresExpensePaymentRepository } from "@/repositories/expense_payment_repository.ts";
import { PostgresExpenseRepository } from "@/repositories/expense_repository.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import { PostgresInvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import { PostgresInvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";
import { PostgresInvoicePaymentRepository } from "@/repositories/invoice_payment_repository.ts";
import { PostgresOrganizationRepository } from "@/repositories/organization_repository.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { AuthService } from "@/services/auth_service.ts";
import { BankConnectionService } from "@/services/banking/bank_connection_service.ts";
import { AesGcmCredentialCipher } from "@/services/banking/credential_cipher.ts";
import { BankSyncService } from "@/services/banking/bank_sync_service.ts";
import type { BankProvider } from "@/services/banking/bank_provider.ts";
import { ExpensePaymentService } from "@/services/banking/expense_payment_service.ts";
import { InvoicePaymentService } from "@/services/banking/invoice_payment_service.ts";
import {
  ExpenseCategoryService,
  ExpenseCategoryValidationError,
} from "@/services/expense_category_service.ts";
import {
  ExpenseAttachmentService,
  readVerifiedExpenseAttachment,
} from "@/services/expense_attachment_service.ts";
import { ExpenseService } from "@/services/expense_service.ts";
import { InvoiceTemplateService } from "@/services/invoice_template_service.ts";
import { InvoiceService } from "@/services/invoice_service.ts";
import { createInvoiceViewModel } from "@/services/invoice_view_model_service.ts";
import {
  InvoiceDocumentService,
  readVerifiedInvoiceDocument,
} from "@/services/invoice_document_service.ts";
import type { PdfRenderer } from "@/services/pdf/chromium_pdf_renderer.ts";
import type {
  ObjectStorage,
  StoredObject,
} from "@/services/storage/object_storage.ts";

const testDatabaseUrl = Deno.env.get("TEST_DATABASE_URL");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();

  put(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, data.slice());
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    const data = this.objects.get(key);
    return Promise.resolve(data ? { data: data.slice() } : null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

class HtmlEchoPdfRenderer implements PdfRenderer {
  render(html: string): Promise<Uint8Array> {
    return Promise.resolve(new TextEncoder().encode(`%PDF-1.7\n${html}`));
  }
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
  name: "expense integration: lifecycle, category filters and tenant isolation",
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
    const categoryRepository = new PostgresExpenseCategoryRepository(sql);
    const expenseRepository = new PostgresExpenseRepository(sql);
    const bankAccountRepository = new PostgresBankAccountRepository(sql);
    const bankConnectionRepository = new PostgresBankConnectionRepository(sql);
    const bankTransactionRepository = new PostgresBankTransactionRepository(
      sql,
    );
    const expensePaymentRepository = new PostgresExpensePaymentRepository(sql);
    const expensePaymentService = new ExpensePaymentService(
      expensePaymentRepository,
    );
    const categoryService = new ExpenseCategoryService(categoryRepository);
    const expenseService = new ExpenseService(expenseRepository);
    const ownerId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const otherContactId = crypto.randomUUID();
    const passwordHash = await hashPassword("integration-password", 10_000);

    try {
      await authRepository.createUser({
        id: ownerId,
        email: `expense-owner-${ownerId}@example.test`,
        displayName: "Expense owner",
        passwordHash,
      });
      await authRepository.createUser({
        id: outsiderId,
        email: `expense-outsider-${outsiderId}@example.test`,
        displayName: "Expense outsider",
        passwordHash,
      });
      await organizationRepository.createWithOwner({
        id: organizationId,
        type: "SRO",
        officialName: "Expense Test s.r.o.",
        displayName: "Expense Test",
        ownerUserId: ownerId,
      });
      await organizationRepository.createWithOwner({
        id: otherOrganizationId,
        type: "OSVC",
        officialName: "Other Expense Test",
        displayName: "Other Expense Test",
        ownerUserId: ownerId,
      });

      const defaults = await categoryRepository.listForUser(
        organizationId,
        ownerId,
        true,
      );
      assert(defaults.length === 7, "organization has no default categories");
      assert(
        defaults.some((category) => category.name === "Ostatní"),
        "default Ostatní category is missing",
      );
      assert(
        (await categoryRepository.listForUser(
          organizationId,
          outsiderId,
          true,
        )).length === 0,
        "expense categories leaked to outsider",
      );

      const insurance = await categoryService.create({
        organizationId,
        userId: ownerId,
        name: " Pojištění ",
        isActive: true,
      });
      assert(insurance?.name === "Pojištění", "category creation failed");
      let duplicateRejected = false;
      try {
        await categoryService.create({
          organizationId,
          userId: ownerId,
          name: "pojištění",
          isActive: true,
        });
      } catch (error) {
        duplicateRejected = error instanceof ExpenseCategoryValidationError;
      }
      assert(duplicateRejected, "case-insensitive duplicate was accepted");

      const contactInput = {
        userId: ownerId,
        type: "COMPANY" as const,
        name: "Supplier s.r.o.",
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
      };
      await contactRepository.createForUser({
        ...contactInput,
        id: contactId,
        organizationId,
      });
      await contactRepository.createForUser({
        ...contactInput,
        id: otherContactId,
        organizationId: otherOrganizationId,
      });

      const expenseValues = {
        organizationId,
        userId: ownerId,
        contactId,
        documentType: "INVOICE",
        supplierName: "Supplier s.r.o.",
        supplierInvoiceNumber: "PF-42",
        issueDate: "2026-09-09",
        taxableSupplyDate: "2026-09-08",
        dueDate: "2026-09-23",
        paymentDate: "",
        description: "Hosting na jeden rok",
        categoryId: insurance!.id,
        currency: "CZK",
        totalAmount: "1770",
        note: "Integration test",
        vatLines: [
          { vatRate: "21", baseAmount: "1000", vatAmount: "210" },
          { vatRate: "12", baseAmount: "500", vatAmount: "60" },
        ],
      };
      const expense = await expenseService.create(expenseValues);
      assert(expense?.totalAmount === "1770.00", "expense creation failed");
      assert(
        expense.vatLines.length === 2 &&
          expense.vatBaseTotal === "1500.00" &&
          expense.vatAmountTotal === "270.00",
        "VAT lines or their totals were not persisted",
      );

      const attachmentRepository = new PostgresExpenseAttachmentRepository(
        sql,
      );
      const attachmentStorage = new MemoryObjectStorage();
      const attachmentService = new ExpenseAttachmentService(
        attachmentRepository,
        attachmentStorage,
      );
      const attachment = await attachmentService.upload({
        organizationId,
        expenseId: expense.id,
        userId: ownerId,
        file: new File(["%PDF-1.7\nreceived invoice"], "doklad.pdf", {
          type: "application/pdf",
        }),
      });
      assert(attachment !== null, "expense PDF attachment was not stored");
      assert(
        (await attachmentRepository.listForExpenseForUser(
          organizationId,
          expense.id,
          ownerId,
        )).length === 1,
        "owner cannot list the expense attachment",
      );
      assert(
        (await attachmentRepository.listForExpenseForUser(
          organizationId,
          expense.id,
          outsiderId,
        )).length === 0,
        "attachment list leaked to outsider",
      );
      assert(
        await attachmentRepository.findForUser(
          organizationId,
          expense.id,
          attachment.id,
          outsiderId,
        ) === null,
        "outsider loaded attachment metadata",
      );
      assert(
        !await attachmentService.remove({
          organizationId,
          expenseId: expense.id,
          attachmentId: attachment.id,
          userId: outsiderId,
        }),
        "outsider removed an attachment",
      );
      let attachmentMutationBlocked = false;
      try {
        await sql`
          UPDATE attachments SET filename = 'changed.pdf'
          WHERE id = ${attachment.id}
        `;
      } catch (error) {
        attachmentMutationBlocked = typeof error === "object" &&
          error !== null && "code" in error && error.code === "55000";
      }
      assert(
        attachmentMutationBlocked,
        "database allowed attachment metadata mutation",
      );
      const attachmentBytes = await readVerifiedExpenseAttachment(
        attachmentStorage,
        attachment,
      );
      assert(
        new TextDecoder().decode(attachmentBytes) ===
          "%PDF-1.7\nreceived invoice",
        "stored attachment bytes changed",
      );

      const filtered = await expenseRepository.listForUser({
        organizationId,
        userId: ownerId,
        search: "PF-42",
        categoryId: insurance!.id,
        documentType: "INVOICE",
      });
      assert(
        filtered.length === 1 && filtered[0].id === expense.id,
        "expense filters did not find the record",
      );
      assert(
        (await expenseRepository.listForUser({
          organizationId,
          userId: outsiderId,
          search: "",
          categoryId: null,
          documentType: null,
        })).length === 0,
        "expense list leaked to outsider",
      );
      assert(
        await expenseRepository.findForUser(
          organizationId,
          expense.id,
          outsiderId,
        ) === null,
        "outsider loaded an expense",
      );
      assert(
        await expenseService.create({
          ...expenseValues,
          contactId: otherContactId,
        }) === null,
        "cross-organization contact was accepted",
      );

      const updated = await expenseService.update({
        ...expenseValues,
        id: expense.id,
        documentType: "RECEIPT",
        contactId: "",
        totalAmount: "999,90",
        vatLines: [
          { vatRate: "7.5", baseAmount: "900", vatAmount: "67.50" },
        ],
      });
      assert(
        updated?.documentType === "RECEIPT" &&
          updated.totalAmount === "999.90" && updated.contactId === null &&
          updated.vatLines.length === 1 &&
          updated.vatLines[0].vatRate === "7.5" &&
          updated.vatBaseTotal === "900.00" &&
          updated.vatAmountTotal === "67.50",
        "expense update failed",
      );

      const bankAccount = await bankAccountRepository.createForUser({
        id: crypto.randomUUID(),
        organizationId,
        userId: ownerId,
        name: "Expense payment account",
        bankName: "Test bank",
        accountPrefix: null,
        accountNumber: "123456789",
        bankCode: "0100",
        iban: null,
        bic: null,
        currency: "CZK",
        isDefault: true,
        isActive: true,
      });
      assert(bankAccount !== null, "expense payment account was not created");
      const bankConnectionService = new BankConnectionService(
        bankConnectionRepository,
        new AesGcmCredentialCipher(new Uint8Array(32).fill(19)),
      );
      assert(
        await bankConnectionService.configureFio({
          organizationId,
          bankAccountId: bankAccount!.id,
          userId: ownerId,
          token: "ExpensePaymentFioToken12345",
          enabled: true,
        }) !== null,
        "expense payment bank connection was not configured",
      );
      const imported = await bankTransactionRepository.importForUser({
        organizationId,
        bankAccountId: bankAccount!.id,
        userId: ownerId,
        provider: "FIO",
        transactions: [{
          providerTransactionId: "expense-payment-first",
          bookingDate: "2026-09-09",
          amount: "-400.0000",
          currency: "CZK",
          counterpartyAccount: null,
          counterpartyBankCode: null,
          counterpartyName: "Supplier s.r.o.",
          variableSymbol: "42",
          constantSymbol: null,
          specificSymbol: null,
          message: "First expense allocation",
          rawData: { source: "expense-payment-test" },
        }, {
          providerTransactionId: "expense-payment-second",
          bookingDate: "2026-09-10",
          amount: "-700.0000",
          currency: "CZK",
          counterpartyAccount: null,
          counterpartyBankCode: null,
          counterpartyName: "Supplier s.r.o.",
          variableSymbol: "42",
          constantSymbol: null,
          specificSymbol: null,
          message: "Second expense allocation",
          rawData: { source: "expense-payment-test" },
        }],
        balance: null,
      });
      assert(imported?.inserted === 2, "expense payment transactions failed");
      const outgoing = await bankTransactionRepository.listForUser({
        organizationId,
        userId: ownerId,
        bankAccountId: bankAccount!.id,
        direction: "OUTGOING",
        dateFrom: null,
        dateTo: null,
      });
      const firstTransaction = outgoing.find((transaction) =>
        transaction.providerTransactionId === "expense-payment-first"
      );
      const secondTransaction = outgoing.find((transaction) =>
        transaction.providerTransactionId === "expense-payment-second"
      );
      assert(
        firstTransaction !== undefined && secondTransaction !== undefined,
        "outgoing expense transactions were not listed",
      );
      const firstMatch = await expensePaymentService.manualMatchForUser({
        organizationId,
        userId: ownerId,
        bankTransactionId: firstTransaction.id,
        expenseId: expense.id,
      });
      assert(
        firstMatch.kind === "matched" &&
          firstMatch.payment.amount === "400.0000",
        "first expense allocation has an incorrect amount",
      );
      const candidatesAfterFirst = await expensePaymentRepository
        .listOpenExpenseCandidatesForUser(organizationId, ownerId);
      assert(
        candidatesAfterFirst.find((candidate) => candidate.id === expense.id)
          ?.remainingAmount === "599.9000",
        "expense remaining amount is incorrect after partial allocation",
      );
      let expenseOverallocationBlocked = false;
      try {
        await sql`
          INSERT INTO expense_payments (
            id, organization_id, expense_id, bank_transaction_id, amount,
            created_by
          ) VALUES (
            ${crypto.randomUUID()}, ${organizationId}, ${expense.id},
            ${secondTransaction.id}, 700, ${ownerId}
          )
        `;
      } catch (error) {
        expenseOverallocationBlocked = typeof error === "object" &&
          error !== null && "code" in error && error.code === "23514";
      }
      assert(
        expenseOverallocationBlocked,
        "database allowed an overallocated expense payment",
      );
      assert(
        (await expensePaymentService.manualMatchForUser({
          organizationId,
          userId: outsiderId,
          bankTransactionId: secondTransaction.id,
          expenseId: expense.id,
        })).kind === "not_found",
        "outsider matched an expense payment",
      );
      const secondMatch = await expensePaymentService.manualMatchForUser({
        organizationId,
        userId: ownerId,
        bankTransactionId: secondTransaction.id,
        expenseId: expense.id,
      });
      assert(
        secondMatch.kind === "matched" &&
          secondMatch.payment.amount === "599.9000",
        "expense allocation did not stop at the remaining expense amount",
      );
      const expensePayments = await expensePaymentRepository
        .listForExpenseForUser(organizationId, expense.id, ownerId);
      assert(
        expensePayments.length === 2 &&
          expensePayments.reduce(
              (sum, payment) => sum + Number(payment.amount),
              0,
            ) === 999.9,
        "expense payment allocations were not persisted",
      );
      assert(
        (await expensePaymentRepository.listForExpenseForUser(
          organizationId,
          expense.id,
          outsiderId,
        )).length === 0,
        "expense payments leaked to outsider",
      );
      assert(
        !await expensePaymentService.unmatchForUser({
          organizationId,
          userId: outsiderId,
          paymentId: secondMatch.payment.id,
        }),
        "outsider removed an expense payment",
      );
      assert(
        await expensePaymentService.unmatchForUser({
          organizationId,
          userId: ownerId,
          paymentId: secondMatch.payment.id,
        }),
        "owner could not remove an expense payment",
      );
      assert(
        (await expensePaymentRepository.listForExpenseForUser(
          organizationId,
          expense.id,
          ownerId,
        )).length === 1,
        "removed expense payment remained persisted",
      );
      const expenseDashboard = await new PostgresDashboardRepository(sql)
        .getForUser({
          organizationId,
          userId: ownerId,
          dateFrom: "2026-09-01",
          dateTo: "2026-09-30",
          today: "2026-09-30",
        });
      assert(
        expenseDashboard?.expenseTotals[0]?.currency === "CZK" &&
          expenseDashboard.expenseTotals[0].amount === "999.90",
        "dashboard did not aggregate the expense",
      );
      assert(
        expenseDashboard.cashflowTotals[0]?.amount === "-1100.0000" &&
          expenseDashboard.unmatchedTransactionCount === 1 &&
          expenseDashboard.unmatchedIncomingCount === 0 &&
          expenseDashboard.unmatchedOutgoingCount === 1,
        "dashboard cashflow or outgoing matching metrics are incorrect",
      );
      assert(
        await new PostgresDashboardRepository(sql).getForUser({
          organizationId,
          userId: outsiderId,
          dateFrom: "2026-09-01",
          dateTo: "2026-09-30",
          today: "2026-09-30",
        }) === null,
        "dashboard metrics leaked to outsider",
      );
      const inactive = await categoryService.update({
        organizationId,
        userId: ownerId,
        id: insurance!.id,
        name: insurance!.name,
        isActive: false,
      });
      assert(inactive?.isActive === false, "category deactivation failed");
      assert(
        (await expenseRepository.findForUser(
          organizationId,
          expense.id,
          ownerId,
        ))?.categoryName === "Pojištění",
        "inactive category disappeared from existing expense",
      );
      assert(
        await attachmentService.remove({
          organizationId,
          expenseId: expense.id,
          attachmentId: attachment.id,
          userId: ownerId,
        }),
        "owner could not remove attachment",
      );
      assert(
        attachmentStorage.objects.size === 0,
        "removed attachment remained in storage",
      );
    } finally {
      await sql`DELETE FROM organizations WHERE id IN (${organizationId}, ${otherOrganizationId})`;
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${outsiderId})`;
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
    const bankConnectionRepository = new PostgresBankConnectionRepository(sql);
    const bankTransactionRepository = new PostgresBankTransactionRepository(
      sql,
    );
    const invoicePaymentRepository = new PostgresInvoicePaymentRepository(sql);
    const bankConnectionService = new BankConnectionService(
      bankConnectionRepository,
      new AesGcmCredentialCipher(new Uint8Array(32).fill(13)),
    );
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

      const fioToken = "IntegrationFioReadOnlyToken12345";
      const connection = await bankConnectionService.configureFio({
        organizationId,
        bankAccountId: secondAccount!.id,
        userId: ownerId,
        token: fioToken,
        enabled: true,
      });
      assert(connection !== null, "owner could not configure Fio connection");
      assert(
        !("encryptedCredentials" in connection),
        "public bank connection exposed encrypted credentials",
      );
      const storedConnections = await sql<{ encrypted_credentials: string }[]>`
        SELECT encrypted_credentials
        FROM bank_connections
        WHERE organization_id = ${organizationId}
          AND bank_account_id = ${secondAccount!.id}
      `;
      assert(
        storedConnections.length === 1 &&
          !storedConnections[0].encrypted_credentials.includes(fioToken),
        "Fio token was not encrypted at rest",
      );
      assert(
        await bankConnectionRepository.findForUser(
          organizationId,
          secondAccount!.id,
          outsiderId,
        ) === null,
        "outsider loaded a bank connection",
      );
      assert(
        await bankConnectionService.configureFio({
          organizationId,
          bankAccountId: secondAccount!.id,
          userId: outsiderId,
          token: "UnauthorizedFioReadOnlyToken12345",
          enabled: true,
        }) === null,
        "outsider updated a bank connection",
      );
      const syncCredentials = await bankConnectionService.credentialsForSync({
        organizationId,
        bankAccountId: secondAccount!.id,
        userId: ownerId,
      });
      assert(
        syncCredentials?.token === fioToken,
        "owner could not decrypt the Fio token for a server-side sync",
      );
      let providerCalls = 0;
      const provider: BankProvider = {
        provider: "FIO",
        syncTransactions() {
          providerCalls++;
          return Promise.resolve({
            accountId: null,
            bankId: null,
            iban: secondAccount!.iban,
            currency: "EUR",
            openingBalance: "1000.0000",
            closingBalance: "1125.5000",
            transactions: [{
              providerTransactionId: "fio-integration-incoming",
              bookingDate: "2026-09-02",
              amount: "150.5000",
              currency: "EUR",
              counterpartyAccount: "123456789",
              counterpartyBankCode: "0100",
              counterpartyName: "Customer s.r.o.",
              variableSymbol: "20260001",
              constantSymbol: null,
              specificSymbol: null,
              message: "Invoice payment",
              rawData: { column22: { value: "fio-integration-incoming" } },
            }, {
              providerTransactionId: "fio-integration-outgoing",
              bookingDate: "2026-09-03",
              amount: "-25.0000",
              currency: "EUR",
              counterpartyAccount: null,
              counterpartyBankCode: null,
              counterpartyName: "Supplier s.r.o.",
              variableSymbol: null,
              constantSymbol: null,
              specificSymbol: null,
              message: "Service payment",
              rawData: { column22: { value: "fio-integration-outgoing" } },
            }],
          });
        },
      };
      const syncService = new BankSyncService(
        bankConnectionService,
        bankAccountRepository,
        bankTransactionRepository,
        provider,
        new InvoicePaymentService(invoicePaymentRepository),
      );
      const firstSync = await syncService.sync({
        organizationId,
        bankAccountId: secondAccount!.id,
        userId: ownerId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-09",
      });
      const repeatedSync = await syncService.sync({
        organizationId,
        bankAccountId: secondAccount!.id,
        userId: ownerId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-09",
      });
      assert(
        firstSync?.inserted === 2 && repeatedSync?.inserted === 0 &&
          firstSync.autoMatched === 0 && repeatedSync.autoMatched === 0 &&
          providerCalls === 2,
        "repeated Fio import was not idempotent",
      );
      const importedTransactions = await bankTransactionRepository.listForUser(
        {
          organizationId,
          userId: ownerId,
          bankAccountId: secondAccount!.id,
          direction: "ALL",
          dateFrom: null,
          dateTo: null,
        },
      );
      assert(
        importedTransactions.length === 2 &&
          importedTransactions.some((item) => item.amount === "150.5000") &&
          importedTransactions.some((item) => item.amount === "-25.0000"),
        "bank transactions were not stored with exact amounts",
      );
      const incomingTransactions = await bankTransactionRepository.listForUser(
        {
          organizationId,
          userId: ownerId,
          bankAccountId: secondAccount!.id,
          direction: "INCOMING",
          dateFrom: null,
          dateTo: null,
        },
      );
      assert(
        incomingTransactions.length === 1 &&
          incomingTransactions[0].providerTransactionId ===
            "fio-integration-incoming",
        "bank transaction direction filter is incorrect",
      );
      assert(
        await bankTransactionRepository.listForUser({
          organizationId,
          userId: outsiderId,
          bankAccountId: null,
          direction: "ALL",
          dateFrom: null,
          dateTo: null,
        }).then((items) => items.length) === 0,
        "outsider loaded bank transactions",
      );
      assert(
        await syncService.sync({
              organizationId,
              bankAccountId: secondAccount!.id,
              userId: outsiderId,
              dateFrom: "2026-09-01",
              dateTo: "2026-09-09",
            }) === null && providerCalls === 2,
        "outsider triggered a bank provider request",
      );
      const syncedConnection = await bankConnectionRepository.findForUser(
        organizationId,
        secondAccount!.id,
        ownerId,
      );
      assert(
        syncedConnection?.status === "ACTIVE" &&
          syncedConnection.lastSyncAt !== null &&
          syncedConnection.currentBalance === "1125.5000" &&
          syncedConnection.balanceCurrency === "EUR" &&
          syncedConnection.balanceDate === "2026-09-09",
        "successful sync did not update connection balance and status",
      );
      const rawRows = await sql<{ raw_data: unknown }[]>`
        SELECT raw_data FROM bank_transactions
        WHERE organization_id = ${organizationId}
          AND bank_account_id = ${secondAccount!.id}
          AND provider_transaction_id = 'fio-integration-incoming'
      `;
      assert(
        JSON.stringify(rawRows[0]?.raw_data).includes("column22"),
        "raw provider transaction data was not preserved",
      );
      assert(
        await bankConnectionService.disconnectFio({
          organizationId,
          bankAccountId: secondAccount!.id,
          userId: outsiderId,
        }) === false,
        "outsider disconnected a bank connection",
      );
      assert(
        await bankConnectionService.disconnectFio({
          organizationId,
          bankAccountId: secondAccount!.id,
          userId: ownerId,
        }) === true,
        "owner could not disconnect a bank connection",
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

Deno.test({
  name: "invoice template integration: immutable concurrency-safe versions",
  ignore: testDatabaseUrl === undefined,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    Deno.env.set("DATABASE_URL", testDatabaseUrl!);
    await migrate();

    const sql = getDb();
    const authRepository = new PostgresAuthRepository(sql);
    const repository = new PostgresInvoiceTemplateRepository(sql);
    const service = new InvoiceTemplateService(repository);
    const userId = crypto.randomUUID();
    let templateId: string | null = null;

    try {
      await authRepository.createUser({
        id: userId,
        email: `template-${userId}@example.test`,
        displayName: "Template editor",
        passwordHash: await hashPassword("integration-password", 10_000),
      });

      const defaults = await repository.list();
      assert(
        defaults.some((template) => template.name === "Čistá profesionální"),
        "default invoice template was not seeded",
      );

      const template = await service.create({
        userId,
        name: "Integration template",
        description: "Version test",
        html: "<h1>{{invoice.number}}</h1><table>{{invoice.items}}</table>",
        css: "body { color: #18211c; }",
      });
      templateId = template.id;
      const original = await repository.findVersion(
        template.id,
        template.currentVersionId,
      );
      assert(original?.version === 1, "initial template version is missing");

      await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          service.createVersion({
            templateId: template.id,
            userId,
            name: "Integration template",
            description: `Concurrent version ${index + 2}`,
            html: `<h1>{{invoice.number}}</h1><p>Version ${index + 2}</p>`,
            css: "body { color: #18211c; }",
          })),
      );

      const versions = await repository.listVersions(template.id);
      assert(
        versions.length === 5,
        "concurrent version creation lost a version",
      );
      assert(
        new Set(versions.map((version) => version.version)).size === 5,
        "concurrent version creation produced duplicate numbers",
      );
      const unchangedOriginal = await repository.findVersion(
        template.id,
        template.currentVersionId,
      );
      assert(
        unchangedOriginal?.html === original.html,
        "creating a version mutated historical template content",
      );
      let templateMutationBlocked = false;
      try {
        await sql`
          UPDATE invoice_template_versions SET html = '<p>changed</p>'
          WHERE id = ${template.currentVersionId}
        `;
      } catch (error) {
        templateMutationBlocked = typeof error === "object" &&
          error !== null && "code" in error && error.code === "55000";
      }
      assert(
        templateMutationBlocked,
        "database allowed historical template version mutation",
      );
    } finally {
      if (templateId !== null) {
        await sql`UPDATE invoice_templates SET current_version_id = NULL WHERE id = ${templateId}`;
        await sql`DELETE FROM invoice_template_versions WHERE invoice_template_id = ${templateId}`;
        await sql`DELETE FROM invoice_templates WHERE id = ${templateId}`;
      }
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await closeDb();
    }
  },
});

Deno.test({
  name:
    "invoice draft integration: CRUD, tenant isolation and concurrent numbering",
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
    const invoiceRepository = new PostgresInvoiceRepository(sql);
    const sequenceRepository = new PostgresInvoiceNumberSequenceRepository(sql);
    const invoiceService = new InvoiceService(invoiceRepository);
    const ownerId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const otherContactId = crypto.randomUUID();
    const passwordHash = await hashPassword("integration-password", 10_000);

    try {
      await authRepository.createUser({
        id: ownerId,
        email: `invoice-owner-${ownerId}@example.test`,
        displayName: "Invoice owner",
        passwordHash,
      });
      await authRepository.createUser({
        id: outsiderId,
        email: `invoice-outsider-${outsiderId}@example.test`,
        displayName: "Invoice outsider",
        passwordHash,
      });
      await organizationRepository.createWithOwner({
        id: organizationId,
        type: "SRO",
        officialName: "Invoice Test s.r.o.",
        displayName: "Invoice Test",
        ownerUserId: ownerId,
      });
      await organizationRepository.createWithOwner({
        id: otherOrganizationId,
        type: "SRO",
        officialName: "Other Invoice Test s.r.o.",
        displayName: "Other Invoice Test",
        ownerUserId: ownerId,
      });
      await contactRepository.createForUser({
        id: contactId,
        organizationId,
        userId: ownerId,
        type: "COMPANY",
        name: "Draft Customer s.r.o.",
        ico: "12345678",
        dic: null,
        street: "Původní 1",
        city: "Praha",
        postalCode: "110 00",
        country: "CZ",
        email: null,
        phone: null,
        defaultDueDays: 14,
        note: null,
      });
      await contactRepository.createForUser({
        id: otherContactId,
        organizationId: otherOrganizationId,
        userId: ownerId,
        type: "COMPANY",
        name: "Other Customer s.r.o.",
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
      });

      const sequences = await sequenceRepository.listForUser(
        organizationId,
        ownerId,
      );
      assert(
        sequences.length === 1 && sequences[0].isDefault,
        "new organization did not receive a default number sequence",
      );
      const templates = await new PostgresInvoiceTemplateRepository(sql).list();
      const draftInput = {
        organizationId,
        userId: ownerId,
        contactId,
        numberSequenceId: sequences[0].id,
        bankAccountId: "",
        invoiceTemplateId: templates[0].id,
        variableSymbol: "",
        issueDate: "2026-09-09",
        dueDate: "2026-09-23",
        currency: "CZK",
        note: "Integration draft",
        items: [
          {
            description: "Služby",
            quantity: "2",
            unit: "hod",
            unitPrice: "999.90",
          },
          {
            description: "Materiál",
            quantity: "1.5",
            unit: "ks",
            unitPrice: "10.00",
          },
        ],
      };
      const invoice = await invoiceService.createDraft(draftInput);
      assert(invoice?.status === "DRAFT", "draft was not created");
      assert(invoice.number === null, "draft received a definitive number");
      assert(invoice.total === "2014.80", "draft exact total is wrong");
      assert(invoice.items.length === 2, "draft items were not saved");
      assert(
        await invoiceRepository.findForUser(
          organizationId,
          invoice.id,
          outsiderId,
        ) === null,
        "outsider loaded a draft without membership",
      );
      assert(
        await invoiceService.updateDraft({
          ...draftInput,
          id: invoice.id,
          userId: outsiderId,
          note: "Unauthorized update",
        }) === null,
        "outsider updated a draft without membership",
      );

      const crossTenantDraft = await invoiceService.createDraft({
        ...draftInput,
        contactId: otherContactId,
      });
      assert(crossTenantDraft === null, "contact leaked across organizations");

      const updated = await invoiceService.updateDraft({
        ...draftInput,
        id: invoice.id,
        note: "Updated draft",
        items: [{
          description: "Paušál",
          quantity: "1",
          unit: "ks",
          unitPrice: "2500",
        }],
      });
      assert(
        updated?.total === "2500.00",
        "draft update did not replace totals",
      );
      assert(updated.items.length === 1, "draft update did not replace items");

      const year = 2026;
      const allocated = await Promise.all(
        Array.from(
          { length: 12 },
          () =>
            sequenceRepository.allocateNextForUser({
              organizationId,
              sequenceId: sequences[0].id,
              userId: ownerId,
              year,
            }),
        ),
      );
      assert(
        allocated.every((number) => number !== null),
        "number allocation failed",
      );
      assert(
        new Set(allocated).size === 12,
        "concurrent allocation produced duplicate numbers",
      );
      assert(
        await sequenceRepository.allocateNextForUser({
          organizationId,
          sequenceId: sequences[0].id,
          userId: outsiderId,
          year,
        }) === null,
        "outsider allocated an invoice number",
      );
    } finally {
      await sql`DELETE FROM organizations WHERE id IN (${organizationId}, ${otherOrganizationId})`;
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${outsiderId})`;
      await closeDb();
    }
  },
});

Deno.test({
  name:
    "invoice issue integration: atomic unique numbers and immutable snapshots",
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
    const contactRepository = new PostgresContactRepository(sql);
    const bankRepository = new PostgresBankAccountRepository(sql);
    const sequenceRepository = new PostgresInvoiceNumberSequenceRepository(sql);
    const invoiceRepository = new PostgresInvoiceRepository(sql);
    const bankConnectionRepository = new PostgresBankConnectionRepository(sql);
    const bankTransactionRepository = new PostgresBankTransactionRepository(
      sql,
    );
    const invoicePaymentRepository = new PostgresInvoicePaymentRepository(sql);
    const invoicePaymentService = new InvoicePaymentService(
      invoicePaymentRepository,
    );
    const documentStorage = new MemoryObjectStorage();
    const invoiceService = new InvoiceService(
      invoiceRepository,
      new InvoiceDocumentService(new HtmlEchoPdfRenderer(), documentStorage),
    );
    const documentRepository = new PostgresInvoiceDocumentRepository(sql);
    const templateRepository = new PostgresInvoiceTemplateRepository(sql);
    const templateService = new InvoiceTemplateService(templateRepository);
    const ownerId = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    let templateId: string | null = null;
    const passwordHash = await hashPassword("integration-password", 10_000);

    try {
      await authRepository.createUser({
        id: ownerId,
        email: `issue-owner-${ownerId}@example.test`,
        displayName: "Issue owner",
        passwordHash,
      });
      await authRepository.createUser({
        id: outsiderId,
        email: `issue-outsider-${outsiderId}@example.test`,
        displayName: "Issue outsider",
        passwordHash,
      });
      await organizationRepository.createWithOwner({
        id: organizationId,
        type: "SRO",
        officialName: "Snapshot Supplier s.r.o.",
        displayName: "Snapshot Supplier",
        ownerUserId: ownerId,
      });
      const settings = await settingsRepository.findForUser(
        organizationId,
        ownerId,
      );
      assert(settings !== null, "supplier settings are missing");
      assert(
        await settingsRepository.updateForUser({
          ...settings,
          street: "Dodavatelská 1",
          city: "Praha",
          postalCode: "110 00",
          userId: ownerId,
        }),
        "supplier settings could not be prepared",
      );
      await contactRepository.createForUser({
        id: contactId,
        organizationId,
        userId: ownerId,
        type: "COMPANY",
        name: "Snapshot Customer s.r.o.",
        ico: "87654321",
        dic: null,
        street: "Odběratelská 2",
        city: "Brno",
        postalCode: "602 00",
        country: "CZ",
        email: "old@example.test",
        phone: null,
        defaultDueDays: 14,
        note: null,
      });
      const bankAccount = await bankRepository.createForUser({
        id: crypto.randomUUID(),
        organizationId,
        userId: ownerId,
        name: "Původní účet",
        bankName: "Test banka",
        accountPrefix: null,
        accountNumber: "123456789",
        bankCode: "0100",
        iban: null,
        bic: null,
        currency: "CZK",
        isDefault: true,
        isActive: true,
      });
      assert(bankAccount !== null, "bank account could not be created");
      const template = await templateService.create({
        userId: ownerId,
        name: "Snapshot integration template",
        description: "Snapshot test",
        html: "<h1>{{invoice.number}}</h1><table>{{invoice.items}}</table>",
        css: "body { color: #18211c; }",
      });
      templateId = template.id;
      const sequence = (await sequenceRepository.listForUser(
        organizationId,
        ownerId,
      ))[0];
      const draftValues = {
        organizationId,
        userId: ownerId,
        contactId,
        numberSequenceId: sequence.id,
        bankAccountId: bankAccount.id,
        invoiceTemplateId: template.id,
        variableSymbol: "",
        issueDate: "2026-09-09",
        dueDate: "2026-09-23",
        currency: "CZK",
        note: "Snapshot test",
        items: [{
          description: "Služba",
          quantity: "1",
          unit: "ks",
          unitPrice: "1000.00",
        }],
      };
      const drafts = await Promise.all(
        Array.from(
          { length: 8 },
          () => invoiceService.createDraft(draftValues),
        ),
      );
      assert(drafts.every((draft) => draft !== null), "draft setup failed");
      assert(
        (await invoiceService.issue({
          id: drafts[0]!.id,
          organizationId,
          userId: outsiderId,
        })).kind === "not_found",
        "outsider issued a foreign invoice",
      );

      const issuedResults = await Promise.all(
        drafts.map((draft) =>
          invoiceService.issue({
            id: draft!.id,
            organizationId,
            userId: ownerId,
          })
        ),
      );
      assert(
        issuedResults.every((result) => result.kind === "issued"),
        "one of concurrent invoice issues failed",
      );
      const issuedInvoices = issuedResults.map((result) => {
        if (result.kind !== "issued") throw new Error("invoice was not issued");
        return result.invoice;
      });
      assert(
        new Set(issuedInvoices.map((invoice) => invoice.number)).size === 8,
        "concurrent invoice issue produced duplicate numbers",
      );
      const original = issuedInvoices[0];
      assert(original.status === "ISSUED", "invoice status was not changed");
      assert(original.issuedAt instanceof Date, "issued timestamp is missing");
      assert(original.issuedBy === ownerId, "issuing user was not recorded");
      assert(
        original.customerSnapshot?.street === "Odběratelská 2",
        `customer snapshot is wrong: ${
          JSON.stringify(original.customerSnapshot)
        }`,
      );
      assert(
        original.supplierSnapshot?.street === "Dodavatelská 1",
        "supplier snapshot is wrong",
      );
      assert(
        original.bankAccountSnapshot?.accountNumber === "123456789",
        "bank account snapshot is wrong",
      );
      assert(
        original.templateVersionId === template.currentVersionId,
        "template version was not locked",
      );
      const invoiceViewModel = await createInvoiceViewModel(original);
      assert(
        invoiceViewModel.payment.iban === "CZ1801000000000123456789",
        `invoice view model has an unexpected IBAN: ${invoiceViewModel.payment.iban}`,
      );
      assert(
        invoiceViewModel.payment.qrSvg.startsWith("<svg"),
        "issued invoice has no QR payment SVG",
      );
      const originalDocument = await documentRepository.findPdfForUser(
        organizationId,
        original.id,
        ownerId,
      );
      assert(originalDocument !== null, "issued invoice has no PDF metadata");
      assert(
        await documentRepository.findPdfForUser(
          organizationId,
          original.id,
          outsiderId,
        ) === null,
        "outsider loaded invoice PDF metadata",
      );
      const originalPdf = await readVerifiedInvoiceDocument(
        documentStorage,
        originalDocument,
      );
      assert(
        new TextDecoder().decode(originalPdf).startsWith("%PDF-1.7"),
        "stored invoice document is not a PDF",
      );
      assert(
        issuedInvoices.every((invoice) =>
          invoice.variableSymbol !== null && /^\d{1,10}$/.test(
            invoice.variableSymbol,
          )
        ),
        "variable symbol was not derived from the invoice number",
      );
      assert(
        (await invoiceService.issue({
          id: original.id,
          organizationId,
          userId: ownerId,
        })).kind === "not_draft",
        "repeated issue was not rejected idempotently",
      );

      const paymentConnectionService = new BankConnectionService(
        bankConnectionRepository,
        new AesGcmCredentialCipher(new Uint8Array(32).fill(17)),
      );
      assert(
        await paymentConnectionService.configureFio({
          organizationId,
          bankAccountId: bankAccount.id,
          userId: ownerId,
          token: "InvoiceMatchingFioToken123456",
          enabled: true,
        }) !== null,
        "bank connection for invoice matching was not created",
      );
      assert(
        await bankTransactionRepository.importForUser({
          organizationId,
          bankAccountId: bankAccount.id,
          userId: ownerId,
          provider: "FIO",
          transactions: [{
            providerTransactionId: "invoice-auto-match-transaction",
            bookingDate: "2026-09-12",
            amount: "1000.0000",
            currency: "CZK",
            counterpartyAccount: "987654321",
            counterpartyBankCode: "0300",
            counterpartyName: "Snapshot Customer s.r.o.",
            variableSymbol: original.variableSymbol,
            constantSymbol: null,
            specificSymbol: null,
            message: "Úhrada faktury",
            rawData: { source: "invoice-matching-integration" },
          }],
          balance: null,
        }).then((result) => result?.inserted) === 1,
        "matching transaction was not imported",
      );
      const paymentTransactions = await bankTransactionRepository.listForUser({
        organizationId,
        userId: ownerId,
        bankAccountId: bankAccount.id,
        direction: "INCOMING",
        dateFrom: null,
        dateTo: null,
      });
      assert(
        paymentTransactions.length === 1,
        "matching transaction could not be loaded",
      );
      assert(
        await invoicePaymentService.autoMatchForUser({
          organizationId,
          userId: ownerId,
          bankAccountId: bankAccount.id,
        }) === 1,
        "high-confidence invoice payment was not matched automatically",
      );
      const automaticallyPaid = await invoiceRepository.findForUser(
        organizationId,
        original.id,
        ownerId,
      );
      assert(
        automaticallyPaid?.status === "PAID" &&
          automaticallyPaid.paidAt !== null,
        "automatic match did not mark the invoice as paid",
      );
      const automaticPayments = await invoicePaymentRepository
        .listForInvoiceForUser(organizationId, original.id, ownerId);
      assert(
        automaticPayments.length === 1 &&
          automaticPayments[0].matchType === "AUTO" &&
          automaticPayments[0].amount === "1000.0000",
        "automatic payment relation is incorrect",
      );
      assert(
        await invoicePaymentService.autoMatchForUser({
          organizationId,
          userId: outsiderId,
          bankAccountId: bankAccount.id,
        }) === null,
        "outsider triggered automatic invoice matching",
      );
      assert(
        await invoicePaymentService.unmatchForUser({
          organizationId,
          userId: outsiderId,
          paymentId: automaticPayments[0].id,
        }) === false,
        "outsider removed an invoice payment",
      );
      assert(
        await invoicePaymentService.unmatchForUser({
          organizationId,
          userId: ownerId,
          paymentId: automaticPayments[0].id,
        }),
        "owner could not remove an automatic invoice payment",
      );
      const reopenedInvoice = await invoiceRepository.findForUser(
        organizationId,
        original.id,
        ownerId,
      );
      assert(
        reopenedInvoice?.status === "ISSUED" && reopenedInvoice.paidAt === null,
        "unmatching did not reopen the invoice",
      );
      const manualMatch = await invoicePaymentService.manualMatchForUser({
        organizationId,
        userId: ownerId,
        bankTransactionId: paymentTransactions[0].id,
        invoiceId: original.id,
      });
      assert(
        manualMatch.kind === "matched" &&
          manualMatch.payment.matchType === "MANUAL",
        "owner could not match the payment manually",
      );
      assert(
        (await invoiceRepository.findForUser(
          organizationId,
          original.id,
          ownerId,
        ))?.status === "PAID",
        "manual match did not mark the invoice as paid",
      );
      let invoiceOverallocationBlocked = false;
      try {
        await sql`
          INSERT INTO invoice_payments (
            id, organization_id, invoice_id, bank_transaction_id, amount,
            match_type, created_by
          ) VALUES (
            ${crypto.randomUUID()}, ${organizationId}, ${issuedInvoices[1].id},
            ${paymentTransactions[0].id}, 1, 'MANUAL', ${ownerId}
          )
        `;
      } catch (error) {
        invoiceOverallocationBlocked = typeof error === "object" &&
          error !== null && "code" in error && error.code === "23514";
      }
      assert(
        invoiceOverallocationBlocked,
        "database allowed an overallocated invoice payment",
      );
      let bankTransactionMutationBlocked = false;
      try {
        await sql`
          UPDATE bank_transactions SET amount = 2000
          WHERE id = ${paymentTransactions[0].id}
        `;
      } catch (error) {
        bankTransactionMutationBlocked = typeof error === "object" &&
          error !== null && "code" in error && error.code === "55000";
      }
      assert(
        bankTransactionMutationBlocked,
        "database allowed imported bank transaction mutation",
      );

      const ambiguousVariableSymbol = "7777777777";
      const ambiguousDrafts = await Promise.all([
        invoiceService.createDraft({
          ...draftValues,
          variableSymbol: ambiguousVariableSymbol,
        }),
        invoiceService.createDraft({
          ...draftValues,
          variableSymbol: ambiguousVariableSymbol,
        }),
      ]);
      assert(
        ambiguousDrafts.every((draft) => draft !== null),
        "ambiguous matching drafts were not created",
      );
      const ambiguousIssues = await Promise.all(
        ambiguousDrafts.map((draft) =>
          invoiceService.issue({
            id: draft!.id,
            organizationId,
            userId: ownerId,
          })
        ),
      );
      assert(
        ambiguousIssues.every((result) => result.kind === "issued"),
        "ambiguous matching invoices were not issued",
      );
      assert(
        await bankTransactionRepository.importForUser({
          organizationId,
          bankAccountId: bankAccount.id,
          userId: ownerId,
          provider: "FIO",
          transactions: [{
            providerTransactionId: "invoice-ambiguous-transaction",
            bookingDate: "2026-09-13",
            amount: "1000.0000",
            currency: "CZK",
            counterpartyAccount: null,
            counterpartyBankCode: null,
            counterpartyName: "Ambiguous customer",
            variableSymbol: ambiguousVariableSymbol,
            constantSymbol: null,
            specificSymbol: null,
            message: null,
            rawData: { source: "ambiguous-matching-integration" },
          }],
          balance: {
            amount: "5000.0000",
            currency: "CZK",
            date: "2026-09-13",
          },
        }).then((result) => result?.inserted) === 1,
        "ambiguous matching transaction was not imported",
      );
      assert(
        await invoicePaymentService.autoMatchForUser({
          organizationId,
          userId: ownerId,
          bankAccountId: bankAccount.id,
        }) === 0,
        "ambiguous candidate was matched automatically",
      );
      for (const draft of ambiguousDrafts) {
        assert(
          (await invoiceRepository.findForUser(
            organizationId,
            draft!.id,
            ownerId,
          ))?.status === "ISSUED",
          "ambiguous automatic matching changed an invoice status",
        );
      }

      const invoiceDashboard = await new PostgresDashboardRepository(sql)
        .getForUser({
          organizationId,
          userId: ownerId,
          dateFrom: "2026-09-01",
          dateTo: "2026-09-30",
          today: "2026-09-24",
        });
      assert(
        invoiceDashboard?.issuedInvoiceCount === 10 &&
          invoiceDashboard.issuedInvoiceTotals[0]?.amount === "10000.00",
        "dashboard invoice totals are incorrect",
      );
      assert(
        invoiceDashboard.unpaidInvoiceCount === 9 &&
          Number(invoiceDashboard.unpaidInvoiceTotals[0]?.amount) === 9000 &&
          invoiceDashboard.overdueInvoiceCount === 9 &&
          Number(invoiceDashboard.overdueInvoiceTotals[0]?.amount) === 9000,
        "dashboard outstanding invoice metrics are incorrect",
      );
      assert(
        invoiceDashboard.incomeTotals[0]?.amount === "2000.0000" &&
          invoiceDashboard.cashflowTotals[0]?.amount === "2000.0000" &&
          invoiceDashboard.unmatchedTransactionCount === 1 &&
          invoiceDashboard.unmatchedIncomingCount === 1,
        "dashboard income, cashflow or unmatched metrics are incorrect",
      );
      assert(
        invoiceDashboard.bankBalances[0]?.amount === "5000.0000" &&
          invoiceDashboard.bankBalances[0].date === "2026-09-13",
        "dashboard did not expose the available bank balance",
      );

      const failedDraft = await invoiceService.createDraft(draftValues);
      assert(failedDraft !== null, "failed-PDF draft setup failed");
      const failingService = new InvoiceService(
        invoiceRepository,
        new InvoiceDocumentService({
          render: () => Promise.reject(new Error("simulated Chromium failure")),
        }, documentStorage),
      );
      assert(
        (await failingService.issue({
          id: failedDraft.id,
          organizationId,
          userId: ownerId,
        })).kind === "pdf_generation_failed",
        "PDF rendering failure was not reported",
      );
      const draftAfterPdfFailure = await invoiceRepository.findForUser(
        organizationId,
        failedDraft.id,
        ownerId,
      );
      assert(
        draftAfterPdfFailure?.status === "DRAFT" &&
          draftAfterPdfFailure.number === null,
        "PDF rendering failure left a partially issued invoice",
      );

      await contactRepository.updateForUser({
        id: contactId,
        organizationId,
        userId: ownerId,
        type: "COMPANY",
        name: "Changed Customer s.r.o.",
        ico: "87654321",
        dic: null,
        street: "Nová odběratelská 9",
        city: "Ostrava",
        postalCode: "700 00",
        country: "CZ",
        email: "new@example.test",
        phone: null,
        defaultDueDays: 14,
        note: null,
      });
      await settingsRepository.updateForUser({
        ...(await settingsRepository.findForUser(organizationId, ownerId))!,
        street: "Nová dodavatelská 10",
        userId: ownerId,
      });
      await bankRepository.updateForUser({
        ...bankAccount,
        organizationId,
        userId: ownerId,
        name: "Změněný účet",
        accountNumber: "987654321",
      });
      await templateService.createVersion({
        templateId: template.id,
        userId: ownerId,
        name: template.name,
        description: "Changed after issue",
        html:
          "<h1>Změněno {{invoice.number}}</h1><table>{{invoice.items}}</table>",
        css: "body { color: #000; }",
      });

      const historical = await invoiceRepository.findForUser(
        organizationId,
        original.id,
        ownerId,
      );
      assert(
        historical?.customerSnapshot?.street === "Odběratelská 2",
        "customer change mutated historical invoice",
      );
      assert(
        historical.supplierSnapshot?.street === "Dodavatelská 1",
        "supplier change mutated historical invoice",
      );
      assert(
        historical.bankAccountSnapshot?.accountNumber === "123456789",
        "bank account change mutated historical invoice",
      );
      assert(
        historical.templateVersionId === template.currentVersionId,
        "template change mutated historical invoice version",
      );
      const historicalDocument = await documentRepository.findPdfForUser(
        organizationId,
        original.id,
        ownerId,
      );
      assert(
        historicalDocument?.sha256 === originalDocument.sha256,
        "template change mutated historical PDF metadata",
      );
      const historicalPdf = await readVerifiedInvoiceDocument(
        documentStorage,
        historicalDocument!,
      );
      assert(
        new TextDecoder().decode(historicalPdf) ===
          new TextDecoder().decode(originalPdf),
        "template change mutated stored historical PDF bytes",
      );
      assert(
        await invoiceService.updateDraft({
          ...draftValues,
          id: original.id,
          note: "Should not change",
        }) === null,
        "issued invoice was editable through the service",
      );

      let invoiceMutationBlocked = false;
      try {
        await sql`
          UPDATE invoices SET note = 'tampered' WHERE id = ${original.id}
        `;
      } catch (error) {
        invoiceMutationBlocked = typeof error === "object" && error !== null &&
          "code" in error && error.code === "55000";
      }
      assert(
        invoiceMutationBlocked,
        "database allowed issued invoice mutation",
      );
      let itemMutationBlocked = false;
      try {
        await sql`
          UPDATE invoice_items SET description = 'tampered'
          WHERE invoice_id = ${original.id}
        `;
      } catch (error) {
        itemMutationBlocked = typeof error === "object" && error !== null &&
          "code" in error && error.code === "55000";
      }
      assert(itemMutationBlocked, "database allowed issued item mutation");
      let documentMutationBlocked = false;
      try {
        await sql`
          UPDATE invoice_documents SET sha256 = ${"f".repeat(64)}
          WHERE id = ${originalDocument.id}
        `;
      } catch (error) {
        documentMutationBlocked = typeof error === "object" && error !== null &&
          "code" in error && error.code === "55000";
      }
      assert(
        documentMutationBlocked,
        "database allowed invoice PDF metadata mutation",
      );
      let documentDeleteBlocked = false;
      try {
        await sql`
          DELETE FROM invoice_documents WHERE id = ${originalDocument.id}
        `;
      } catch (error) {
        documentDeleteBlocked = typeof error === "object" && error !== null &&
          "code" in error && error.code === "55000";
      }
      assert(
        documentDeleteBlocked,
        "database allowed invoice PDF metadata deletion",
      );
    } finally {
      await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
      if (templateId !== null) {
        await sql`
          UPDATE invoice_templates SET current_version_id = NULL
          WHERE id = ${templateId}
        `;
        await sql`
          DELETE FROM invoice_template_versions
          WHERE invoice_template_id = ${templateId}
        `;
        await sql`DELETE FROM invoice_templates WHERE id = ${templateId}`;
      }
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${outsiderId})`;
      await closeDb();
    }
  },
});
