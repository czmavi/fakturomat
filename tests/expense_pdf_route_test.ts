import { App } from "fresh";
import type { State } from "@/utils.ts";
import { withRuntime } from "@/config/runtime.ts";
import { getDb } from "@/database/client.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { handler } from "@/routes/o/[organizationId]/expenses/extract.ts";
import { assert, testRuntime } from "./d1_test_helper.ts";

Deno.test("PDF extraction reads Cloudflare bindings and returns a useful JSON error", async () => {
  const env = testRuntime();
  env.OPENAI_API_KEY = "worker-test-key";
  env.OPENAI_EXPENSE_MODEL = "worker-test-model";
  const originalFetch = globalThis.fetch;
  let called = false;
  try {
    await withRuntime(env, async () => {
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      await getDb()`INSERT INTO users(id,email,display_name,email_verified) VALUES (${userId}, 'pdf@example.test', 'Owner', true)`;
      await new D1OrganizationRepository().createWithOwner({
        id: organizationId,
        ownerUserId: userId,
        type: "SRO",
        officialName: "Test firma",
        displayName: "Test",
        ico: "12345678",
      });
      globalThis.fetch = (_url, init) => {
        called = true;
        assert(
          new Headers(init?.headers).get("Authorization") ===
            "Bearer worker-test-key",
        );
        assert(JSON.parse(String(init?.body)).model === "worker-test-model");
        return Promise.resolve(new Response(null, { status: 429 }));
      };
      const app = new App<State>();
      app.use((ctx) => {
        ctx.state.user = { id: userId } as State["user"];
        ctx.state.csrfToken = "test-csrf";
        return ctx.next();
      });
      app.post("/o/:organizationId/expenses/extract", handler.POST);
      const form = new FormData();
      form.set("csrf_token", "test-csrf");
      form.set(
        "pdf",
        new File(["%PDF-1.7\n"], "invoice.pdf", { type: "application/pdf" }),
      );
      const response = await app.handler()(
        new Request(
          `https://fakturomat.test/o/${organizationId}/expenses/extract`,
          { method: "POST", body: form },
        ),
      );
      assert(called, "Worker API configuration was not used");
      assert(response.status === 422);
      assert(
        response.headers.get("content-type")?.includes("application/json"),
      );
      assert((await response.json()).error.includes("limit"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    env.DB.sqlite.close();
  }
});

Deno.test("Existing expense AI reads only its authorized attachment, proposes details and matches supplier without saving", async () => {
  const { D1ExpenseRepository } = await import(
    "@/repositories/expense_repository.ts"
  );
  const { ExpenseService } = await import("@/services/expense_service.ts");
  const { D1ExpenseAttachmentRepository } = await import(
    "@/repositories/expense_attachment_repository.ts"
  );
  const { getObjectStorage } = await import(
    "@/services/storage/storage_factory.ts"
  );
  const { sha256Hex } = await import("@/services/storage/integrity.ts");
  const { ContactService } = await import("@/services/contact_service.ts");
  const { D1ContactRepository } = await import(
    "@/repositories/contact_repository.ts"
  );
  const { EMPTY_CONTACT } = await import("@/components/ContactForm.tsx");
  const env = testRuntime();
  env.OPENAI_API_KEY = "test";
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    await withRuntime(env, async () => {
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      const sql = getDb();
      await sql`INSERT INTO users(id,email,display_name,email_verified) VALUES (${userId}, 'enrich@example.test', 'Owner', true)`;
      await new D1OrganizationRepository().createWithOwner({
        id: organizationId,
        ownerUserId: userId,
        type: "SRO",
        officialName: "Buyer s.r.o.",
        displayName: "Buyer",
        ico: "12345678",
      });
      const contact = await new ContactService(new D1ContactRepository())
        .create({
          ...EMPTY_CONTACT,
          name: "Supplier",
          ico: "87654321",
          organizationId,
          userId,
        });
      const repository = new D1ExpenseRepository();
      const expense = await new ExpenseService(repository).create({
        organizationId,
        userId,
        contactId: "",
        categoryId: "",
        documentType: "INVOICE",
        supplierName: "Původní",
        supplierInvoiceNumber: "",
        issueDate: "",
        taxableSupplyDate: "",
        dueDate: "",
        paymentDate: "",
        description: "Původní popis",
        currency: "CZK",
        totalAmount: "121",
        note: "Poznámka",
        vatLines: [],
      });
      assert(expense !== null);
      const bytes = new TextEncoder().encode("%PDF-1.7\nstored invoice");
      const attachmentId = crypto.randomUUID();
      const key = `organizations/${organizationId}/expenses/${
        expense!.id
      }/invoice.pdf`;
      await getObjectStorage().put(key, bytes);
      await new D1ExpenseAttachmentRepository().createForUser({
        id: attachmentId,
        organizationId,
        expenseId: expense!.id,
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        size: bytes.length,
        storageKey: key,
        sha256: await sha256Hex(bytes),
        userId,
      });
      globalThis.fetch = (_url, init) => {
        calls++;
        const request = JSON.parse(String(init?.body));
        assert(
          request.input[0].content[0].file_data.endsWith(bytes.toBase64()),
          "Wrong stored file",
        );
        return Promise.resolve(
          Response.json({
            status: "completed",
            output: [{
              type: "message",
              content: [{
                type: "output_text",
                text: JSON.stringify({
                  isInvoice: true,
                  recipient: { name: "Buyer s.r.o.", ico: "12345678", dic: "" },
                  supplier: {
                    name: "Supplier",
                    ico: "87654321",
                    dic: "",
                    street: "Main 1",
                    city: "Praha",
                    postalCode: "11000",
                    country: "CZ",
                    email: "",
                    phone: "",
                  },
                  supplierName: "Supplier",
                  supplierInvoiceNumber: "INV-1",
                  issueDate: "2026-10-01",
                  taxableSupplyDate: "",
                  dueDate: "2026-10-15",
                  description: "Služba",
                  currency: "CZK",
                  totalAmount: "121.00",
                  vatLines: [{
                    vatRate: "21 %",
                    baseAmount: "100",
                    vatAmount: "21",
                  }],
                  items: [{
                    description: "Služba",
                    quantity: "1",
                    unit: "ks",
                    unitPrice: "100",
                    vatRate: "21 %",
                    totalAmount: "121",
                  }],
                  payment: {
                    accountNumber: "2114736912/2700",
                    iban: "",
                    variableSymbol: "0001",
                    constantSymbol: "0308",
                    specificSymbol: "0002",
                  },
                }),
              }],
            }],
          }),
        );
      };
      const app = new App<State>();
      app.use((ctx) => {
        ctx.state.user = { id: userId } as State["user"];
        ctx.state.csrfToken = "test-csrf";
        return ctx.next();
      });
      app.post("/o/:organizationId/expenses/extract", handler.POST);
      const request = async (
        attachment: string,
        targetExpense = expense!.id,
        csrf = "test-csrf",
      ) => {
        const form = new FormData();
        form.set("csrf_token", csrf);
        form.set("expense_id", targetExpense);
        form.set("attachment_id", attachment);
        return await app.handler()(
          new Request(
            `https://fakturomat.test/o/${organizationId}/expenses/extract`,
            { method: "POST", body: form },
          ),
        );
      };
      assert(
        (await request(attachmentId, expense!.id, "wrong")).status === 403,
      );
      assert((await request(attachmentId, crypto.randomUUID())).status === 404);
      assert((await request(crypto.randomUUID())).status === 404);
      assert(calls === 0, "Unauthorized lookup reached external service");
      const response = await request(attachmentId);
      const result = await response.json();
      assert(response.status === 200, JSON.stringify(result));
      assert(
        result.values.contactId === contact!.id &&
          result.values.details.items[0].totalAmount === "121.00",
      );
      assert(
        result.values.details.variableSymbol === "0001" &&
          result.values.details.iban === "CZ4027000000002114736912",
      );
      const unchanged = await repository.findForUser(
        organizationId,
        expense!.id,
        userId,
      );
      assert(
        unchanged?.supplierName === "Původní" &&
          unchanged.note === "Poznámka" &&
          unchanged.details?.items.length === 0,
        "Extraction mutated expense",
      );
      await new D1ContactRepository().archiveForUser(
        organizationId,
        contact!.id,
        userId,
      );
      const noMatch = await (await request(attachmentId)).json();
      assert(
        noMatch.values.contactId === "" && noMatch.supplier.ico === "87654321",
        "Missing new contact proposal",
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
    env.DB.sqlite.close();
  }
});
