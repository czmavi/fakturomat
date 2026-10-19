import {
  emptyExpenseDetails,
  normalizeExpenseDetails,
} from "@/domain/expenses/details.ts";
import { mergeExpenseExtraction } from "@/domain/expenses/enrichment.ts";
import { matchExpenseSupplier } from "@/services/expense_supplier_service.ts";
import { EMPTY_CONTACT } from "@/components/ContactForm.tsx";
import type { Contact } from "@/domain/contacts/types.ts";
import { assert, rejects, testRuntime } from "./d1_test_helper.ts";
import { withRuntime } from "@/config/runtime.ts";
import { getDb } from "@/database/client.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { D1ExpenseRepository } from "@/repositories/expense_repository.ts";
import { ExpenseService } from "@/services/expense_service.ts";
import {
  expenseInputFromExpense,
  expenseInputFromForm,
} from "@/components/ExpenseForm.tsx";

const details = {
  ...emptyExpenseDetails(),
  accountNumber: "2114736912/2700",
  variableSymbol: "0020260803",
  constantSymbol: "0308",
  specificSymbol: "0032825",
  items: [{
    description: "Služba",
    quantity: "2",
    unit: "hod",
    unitPrice: "100,00",
    vatRate: "21 %",
    totalAmount: "242,00",
  }],
};
const input = {
  contactId: "",
  categoryId: "",
  documentType: "INVOICE",
  supplierName: "Dodavatel",
  supplierInvoiceNumber: "INV-1",
  issueDate: "2026-10-02",
  taxableSupplyDate: "",
  dueDate: "",
  paymentDate: "",
  description: "Služba",
  currency: "CZK",
  totalAmount: "242",
  note: "",
  vatLines: [],
  details,
};

Deno.test("Expense details preserve symbols and validate account and item amounts", async () => {
  const normalized = normalizeExpenseDetails(details);
  assert(normalized.iban === "CZ4027000000002114736912");
  assert(
    normalized.variableSymbol === "0020260803" &&
      normalized.constantSymbol === "0308" &&
      normalized.specificSymbol === "0032825",
  );
  assert(
    normalized.items[0].unitPrice === "100.00" &&
      normalized.items[0].vatRate === "21",
  );
  assert(
    normalizeExpenseDetails({
      ...details,
      accountNumber: "",
      iban: normalized.iban,
    }).accountNumber === details.accountNumber,
  );
  for (
    const invalid of [
      { constantSymbol: "12345" },
      { variableSymbol: "1e5" },
      { specificSymbol: "12345678901" },
      { accountNumber: "124/2700" },
      { iban: "CZ6508000000192000145399" },
    ]
  ) {
    await rejects(() => normalizeExpenseDetails({ ...details, ...invalid }));
  }
  await rejects(() =>
    normalizeExpenseDetails({
      ...details,
      items: [{ ...details.items[0], unitPrice: "bad" }],
    })
  );
});

Deno.test("Supplier matching is unambiguous, respects conflicts and excludes archived contacts", () => {
  const supplier = { ...EMPTY_CONTACT, name: "Test s. r. o.", ico: "12345678" };
  const contact = {
    id: "one",
    name: "Test s.r.o.",
    ico: "12345678",
    dic: null,
    archivedAt: null,
  } as Contact;
  assert(matchExpenseSupplier(supplier, [contact]) === "one");
  assert(
    matchExpenseSupplier(supplier, [{ ...contact, ico: "99999999" }]) === null,
  );
  assert(
    matchExpenseSupplier(supplier, [contact, { ...contact, id: "two" }]) ===
      null,
  );
  assert(
    matchExpenseSupplier(supplier, [{ ...contact, archivedAt: new Date() }]) ===
      null,
  );
  assert(matchExpenseSupplier({ ...supplier, ico: "" }, [contact]) === "one");
});

Deno.test("AI proposal preserves manual metadata and values absent from PDF", () => {
  const current = {
    ...input,
    categoryId: "category",
    contactId: "contact",
    note: "Manual note",
    paymentDate: "2026-10-15",
  };
  const merged = mergeExpenseExtraction(current, {
    ...input,
    supplierInvoiceNumber: "",
    details: emptyExpenseDetails(),
    totalAmount: "300.00",
  });
  assert(
    merged.note === current.note &&
      merged.paymentDate === current.paymentDate &&
      merged.categoryId === "category" && merged.contactId === "contact",
  );
  assert(
    merged.supplierInvoiceNumber === "INV-1" && merged.totalAmount === "300.00",
  );
  assert(
    merged.details?.items.length === 1 &&
      merged.details.variableSymbol === "0020260803",
  );
});

Deno.test("Expense details survive create, detail, edit and update with tenant isolation", async () => {
  const env = testRuntime();
  try {
    await withRuntime(env, async () => {
      const sql = getDb();
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      await sql`INSERT INTO users(id,email,display_name,email_verified) VALUES (${userId}, 'details@example.test', 'Owner', true)`;
      await new D1OrganizationRepository().createWithOwner({
        id: organizationId,
        ownerUserId: userId,
        type: "SRO",
        officialName: "Firma",
        displayName: "Firma",
      });
      const repository = new D1ExpenseRepository();
      const service = new ExpenseService(repository);
      const created = await service.create({
        ...input,
        userId,
        organizationId,
      });
      assert(
        created !== null && created.details?.items[0].totalAmount === "242.00",
      );
      const values = expenseInputFromExpense(created!);
      const updated = await service.update({
        ...values,
        id: created!.id,
        userId,
        organizationId,
        details: { ...values.details!, constantSymbol: "0008" },
      });
      assert(
        updated?.details?.constantSymbol === "0008" &&
          updated.details.items.length === 1,
      );
      assert(
        await repository.findForUser(
          organizationId,
          created!.id,
          crypto.randomUUID(),
        ) === null,
      );
      const form = new FormData();
      for (const [key, value] of Object.entries(details)) {
        if (typeof value === "string") form.set(`expense_${key}`, value);
      }
      for (const [key, value] of Object.entries(details.items[0])) {
        form.append(`item_${key}`, value);
      }
      assert(
        expenseInputFromForm(form).details?.items[0].description === "Služba",
      );
      assert(
        expenseInputFromForm(form).details?.variableSymbol === "0020260803",
      );
    });
  } finally {
    env.DB.sqlite.close();
  }
});
