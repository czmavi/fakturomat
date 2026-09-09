import type {
  Expense,
  ExpenseDocumentType,
  ExpenseSummary,
  NormalizedExpenseInput,
} from "@/domain/expenses/types.ts";
import type { ExpenseRepository } from "@/repositories/expense_repository.ts";
import {
  ExpenseService,
  ExpenseValidationError,
} from "@/services/expense_service.ts";

class FakeExpenseRepository implements ExpenseRepository {
  created:
    | NormalizedExpenseInput
      & { id: string; organizationId: string; userId: string }
    | null = null;

  listForUser(_input: {
    organizationId: string;
    userId: string;
    search: string;
    categoryId: string | null;
    documentType: ExpenseDocumentType | null;
  }): Promise<ExpenseSummary[]> {
    return Promise.resolve([]);
  }

  findForUser(
    _organizationId: string,
    _expenseId: string,
    _userId: string,
  ): Promise<Expense | null> {
    return Promise.resolve(null);
  }

  createForUser(
    input: NormalizedExpenseInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null> {
    this.created = input;
    return Promise.resolve(null);
  }

  updateForUser(
    _input: NormalizedExpenseInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null> {
    return Promise.resolve(null);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  user: "20000000-0000-4000-8000-000000000002",
  contact: "20000000-0000-4000-8000-000000000003",
  category: "20000000-0000-4000-8000-000000000004",
};

function validInput() {
  return {
    organizationId: ids.organization,
    userId: ids.user,
    contactId: ids.contact,
    documentType: "INVOICE",
    supplierName: " Dodavatel s.r.o. ",
    supplierInvoiceNumber: " PF-2026-10 ",
    issueDate: "2026-09-09",
    taxableSupplyDate: "2026-09-08",
    dueDate: "2026-09-23",
    paymentDate: "",
    description: " Roční licence ",
    categoryId: ids.category,
    currency: " czk ",
    totalAmount: "1770",
    note: " Interní poznámka ",
    vatLines: [
      { vatRate: "21.000", baseAmount: "1000", vatAmount: "210" },
      { vatRate: "12", baseAmount: "500", vatAmount: "60" },
    ],
  };
}

Deno.test("expense normalizes exact money and optional fields", async () => {
  const repository = new FakeExpenseRepository();
  await new ExpenseService(repository).create(validInput());

  assert(repository.created !== null, "expense was not passed to repository");
  assert(repository.created.totalAmount === "1770.00", "money is not exact");
  assert(repository.created.currency === "CZK", "currency was not normalized");
  assert(
    repository.created.supplierName === "Dodavatel s.r.o.",
    "supplier was not trimmed",
  );
  assert(repository.created.paymentDate === null, "empty date is not null");
  assert(
    repository.created.note === "Interní poznámka",
    "note was not trimmed",
  );
  assert(repository.created.vatLines.length === 2, "VAT lines are missing");
  assert(
    repository.created.vatLines[0].vatRate === "21" &&
      repository.created.vatLines[0].baseAmount === "1000.00",
    "VAT line was not normalized",
  );
});

Deno.test("expense rejects malformed dates, money and references", async () => {
  const service = new ExpenseService(new FakeExpenseRepository());
  const invalidInputs = [
    { ...validInput(), issueDate: "2026-02-30" },
    { ...validInput(), totalAmount: "10.001" },
    { ...validInput(), totalAmount: "-1" },
    { ...validInput(), documentType: "PURCHASE" },
    { ...validInput(), categoryId: "not-a-uuid" },
    {
      ...validInput(),
      vatLines: [{ vatRate: "10.12345", baseAmount: "100", vatAmount: "10" }],
    },
    {
      ...validInput(),
      vatLines: [{ vatRate: "21", baseAmount: "invalid", vatAmount: "10" }],
    },
  ];

  for (const input of invalidInputs) {
    let rejected = false;
    try {
      await service.create(input);
    } catch (error) {
      rejected = error instanceof ExpenseValidationError;
    }
    assert(rejected, `invalid expense was accepted: ${JSON.stringify(input)}`);
  }
});

Deno.test("expense allows no VAT lines and does not reject rounding differences", async () => {
  const withoutVatRepository = new FakeExpenseRepository();
  await new ExpenseService(withoutVatRepository).create({
    ...validInput(),
    vatLines: [],
  });
  assert(
    withoutVatRepository.created?.vatLines.length === 0,
    "zero VAT lines were not accepted",
  );

  const mismatchRepository = new FakeExpenseRepository();
  await new ExpenseService(mismatchRepository).create({
    ...validInput(),
    totalAmount: "120.01",
    vatLines: [{ vatRate: "21", baseAmount: "100", vatAmount: "20" }],
  });
  assert(
    mismatchRepository.created?.totalAmount === "120.01",
    "manual total differing from VAT lines was rejected",
  );
});
