import { withRuntime } from "@/config/runtime.ts";
import { getDb } from "@/database/client.ts";
import { money } from "@/database/d1.ts";
import { getAuth } from "@/services/better_auth.ts";
import { LEGACY_TEST_PASSWORD_HASH } from "./auth_test_helper.ts";
import { assert, rejects, testRuntime } from "./d1_test_helper.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { D1ContactRepository } from "@/repositories/contact_repository.ts";
import { D1BankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { D1InvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";
import { D1InvoiceRepository } from "@/repositories/invoice_repository.ts";
import { D1InvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import { D1ExpenseRepository } from "@/repositories/expense_repository.ts";
import { D1BankTransactionRepository } from "@/repositories/bank_transaction_repository.ts";
import { D1InvoicePaymentRepository } from "@/repositories/invoice_payment_repository.ts";
import { D1ExpensePaymentRepository } from "@/repositories/expense_payment_repository.ts";
import { D1DashboardRepository } from "@/repositories/dashboard_repository.ts";
import { InvoiceService } from "@/services/invoice_service.ts";
import { ExpenseService } from "@/services/expense_service.ts";
import {
  getInvoiceDocumentDownloadTarget,
  InvoiceDocumentService,
} from "@/services/invoice_document_service.ts";
import { PdfLibRenderer } from "@/services/pdf/pdf_lib_renderer.ts";
import {
  R2DocumentStorage,
  R2ObjectStorage,
} from "@/services/storage/r2_storage.ts";
import { D1InvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";

Deno.test("D1/R2 lifecycle, exact amounts, authentication, immutable documents, tenant scope and payments", async () => {
  const env = testRuntime();
  try {
    await withRuntime(env, async () => {
      const sql = getDb();
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      await sql`INSERT INTO users(id,email,display_name,email_verified) VALUES (${userId}, 'owner@example.test', 'Owner', true)`;
      await sql`INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES (${crypto.randomUUID()}, ${userId}, 'credential', ${userId}, ${LEGACY_TEST_PASSWORD_HASH})`;
      const auth = getAuth();
      // Legacy hashes remain byte-for-byte usable after PostgreSQL export.
      const response = await auth.handler(
        new Request("http://fakturomat.test/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://fakturomat.test",
          },
          body: JSON.stringify({
            email: "owner@example.test",
            password: "integration-password",
          }),
        }),
      );
      assert(
        response.status === 200,
        `login ${response.status}: ${await response.clone().text()}`,
      );
      const cookie = response.headers.get("set-cookie")!;
      assert(cookie.includes("session_token"), "missing session cookie");
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      assert(session?.user.id === userId, "D1 session lookup");
      await new D1OrganizationRepository().createWithOwner({
        id: organizationId,
        ownerUserId: userId,
        type: "SRO",
        officialName: "Firma s.r.o.",
        displayName: "Firma",
      });
      const scope = { organizationId, userId };
      assert(
        (await new D1OrganizationRepository().listForUser(userId)).length === 1,
      );
      assert(
        await new D1OrganizationRepository().findForUser(
          organizationId,
          crypto.randomUUID(),
        ) === null,
      );
      const contact = await new D1ContactRepository().createForUser({
        ...scope,
        id: crypto.randomUUID(),
        type: "COMPANY",
        name: "Odběratel",
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
      assert(contact);
      const bankRepo = new D1BankAccountRepository();
      const bank = await bankRepo.createForUser({
        ...scope,
        id: crypto.randomUUID(),
        name: "Fio",
        bankName: null,
        accountPrefix: null,
        accountNumber: "123456789",
        bankCode: "2010",
        iban: null,
        bic: null,
        currency: "CZK",
        isDefault: true,
        isActive: true,
      });
      assert(bank?.isDefault);
      const sequences = new D1InvoiceNumberSequenceRepository();
      const sequence = (await sequences.listForUser(organizationId, userId))[0];
      const invoiceRepo = new D1InvoiceRepository();
      const invoices = new InvoiceService(invoiceRepo);
      const draftInput = {
        ...scope,
        contactId: contact.id,
        numberSequenceId: sequence.id,
        bankAccountId: bank.id,
        invoiceTemplateId: "10000000-0000-4000-8000-000000000001",
        variableSymbol: "123",
        issueDate: "2026-10-18",
        dueDate: "2026-10-31",
        currency: "CZK",
        note: "Příliš žluťoučký kůň",
        items: [{
          description: "Služba",
          quantity: "2",
          unit: "ks",
          unitPrice: "0.10",
        }],
      };
      const draft = await invoices.createDraft(draftInput);
      assert(draft?.total === "0.20");
      const storage = new R2DocumentStorage(env.DOCUMENTS);
      const preparer = new InvoiceDocumentService(
        new PdfLibRenderer(),
        storage,
      );
      const issued = await invoiceRepo.issueForUser({
        ...scope,
        invoiceId: draft.id,
      }, preparer);
      assert(issued.kind === "issued", JSON.stringify(issued));
      const doc = await new D1InvoiceDocumentRepository().findPdfForUser(
        organizationId,
        draft.id,
        userId,
      );
      assert(doc?.storageProvider === "r2");
      const download = await getInvoiceDocumentDownloadTarget(
        storage,
        doc,
        "faktura.pdf",
      );
      assert(download.kind === "local" && download.data.length > 1000);
      await rejects(() =>
        storage.put({
          key: doc.storageKey,
          data: new Uint8Array([1]),
          contentType: "application/pdf",
        })
      );
      await rejects(() =>
        sql`UPDATE invoices SET total = 500 WHERE id = ${draft.id}`
      );
      await rejects(() =>
        sql`DELETE FROM invoice_items WHERE invoice_id = ${draft.id}`
      );
      await rejects(() =>
        sql`UPDATE invoice_documents SET sha256 = ${
          "a".repeat(64)
        } WHERE id = ${doc.id}`
      );
      assert(
        await invoiceRepo.findForUser(
          organizationId,
          draft.id,
          crypto.randomUUID(),
        ) === null,
      );
      // Batch failure must roll back earlier writes.
      const failedId = crypto.randomUUID();
      await rejects(() =>
        sql.begin((tx) => {
          tx.queue(
            tx`INSERT INTO contacts(id,organization_id,type,name) VALUES (${failedId},${organizationId},'COMPANY','Rollback')`,
          );
          tx.queue(
            tx`INSERT INTO users(id,email,display_name) VALUES (${userId},'duplicate@example.test','Duplicate')`,
          );
        })
      );
      assert(
        !(await sql`SELECT id FROM contacts WHERE id = ${failedId}`).length,
      );
      const templates = new D1InvoiceTemplateRepository();
      const version = await templates.createVersion({
        ...scope,
        templateId: draftInput.invoiceTemplateId,
        copyTemplateId: crypto.randomUUID(),
        copyBaseVersionId: crypto.randomUUID(),
        versionId: crypto.randomUUID(),
        name: "Kopie",
        description: null,
        html: "<p>{{invoice.number}}</p>",
        css: "p { color: black; }",
        createdBy: userId,
      });
      assert(version?.version === 2, "template copy");
      const expenseRepo = new D1ExpenseRepository();
      const expense = await new ExpenseService(expenseRepo).create({
        ...scope,
        contactId: "",
        documentType: "INVOICE",
        supplierName: "Dodavatel",
        supplierInvoiceNumber: "1",
        issueDate: "2026-10-18",
        taxableSupplyDate: "",
        dueDate: "",
        paymentDate: "",
        description: "Náklad",
        categoryId: "",
        currency: "CZK",
        totalAmount: "0.30",
        note: "",
        vatLines: [],
      });
      assert(expense?.totalAmount === "0.30");
      await sql`INSERT INTO bank_connections(id,organization_id,bank_account_id,provider,encrypted_credentials,status) VALUES (${crypto.randomUUID()},${organizationId},${bank.id},'FIO','test','CONFIGURED')`;
      const movements = new D1BankTransactionRepository();
      const movement = {
        bookingDate: "2026-10-18",
        currency: "CZK",
        counterpartyAccount: null,
        counterpartyBankCode: null,
        counterpartyName: null,
        variableSymbol: "123",
        constantSymbol: null,
        specificSymbol: null,
        message: null,
        rawData: { test: true },
      };
      const batch = {
        ...scope,
        bankAccountId: bank.id,
        provider: "FIO" as const,
        transactions: [{
          ...movement,
          providerTransactionId: "in",
          amount: "0.2000",
        }, { ...movement, providerTransactionId: "out", amount: "-0.4000" }],
        balance: { amount: "1.2345", currency: "CZK", date: "2026-10-18" },
      };
      assert((await movements.importForUser(batch))?.inserted === 2);
      assert((await movements.importForUser(batch))?.inserted === 0);
      const rows = await movements.listForUser({
        ...scope,
        bankAccountId: bank.id,
        direction: "ALL",
        dateFrom: null,
        dateTo: null,
      });
      const outgoing = rows.find((r) => r.providerTransactionId === "out")!;
      const payments = new D1InvoicePaymentRepository();
      assert(
        await payments.autoMatchForUser({
          ...scope,
          bankAccountId: bank.id,
        }) === 1,
      );
      assert(
        (await invoiceRepo.findForUser(organizationId, draft.id, userId))
          ?.status === "PAID",
      );
      const expensePayments = new D1ExpensePaymentRepository();
      const match = await expensePayments.manualMatchForUser({
        ...scope,
        expenseId: expense.id,
        bankTransactionId: outgoing.id,
      });
      assert(
        match.kind === "matched" && match.payment.amount === "0.30",
        JSON.stringify(match),
      );
      await rejects(() =>
        sql`INSERT INTO expense_payments(id,organization_id,expense_id,bank_transaction_id,amount) VALUES (${crypto.randomUUID()},${organizationId},${expense.id},${outgoing.id},${
          money("0.10")
        })`
      );
      const dashboard = await new D1DashboardRepository().getForUser({
        ...scope,
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
        today: "2026-10-18",
      });
      assert(
        dashboard?.incomeTotals[0].amount === "0.20",
        JSON.stringify(dashboard),
      );
      assert(
        await expensePayments.unmatchForUser({
          ...scope,
          paymentId: match.payment.id,
        }),
      );
      const objectStorage = new R2ObjectStorage(env.FILES);
      await objectStorage.put(
        "organizations/test/logo.png",
        new Uint8Array([1, 2, 3]),
      );
      assert(
        (await objectStorage.get("organizations/test/logo.png"))?.data
          .length === 3,
      );
      await objectStorage.delete("organizations/test/logo.png");
      assert(await objectStorage.get("organizations/test/logo.png") === null);
      await rejects(() => objectStorage.get("../escape"));
      await auth.api.signOut({ headers: new Headers({ cookie }) });
      assert(
        await auth.api.getSession({ headers: new Headers({ cookie }) }) ===
          null,
      );
    });
  } finally {
    env.DB.sqlite.close();
  }
});
