import type {
  ExpenseCategory,
  ExpenseCategoryInput,
} from "@/domain/expenses/types.ts";
import type { ExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";
import {
  ExpenseCategoryService,
  ExpenseCategoryValidationError,
} from "@/services/expense_category_service.ts";

class FakeCategoryRepository implements ExpenseCategoryRepository {
  createdName: string | null = null;

  listForUser(
    _organizationId: string,
    _userId: string,
    _includeInactive: boolean,
  ): Promise<ExpenseCategory[]> {
    return Promise.resolve([]);
  }

  findForUser(
    _organizationId: string,
    _categoryId: string,
    _userId: string,
  ): Promise<ExpenseCategory | null> {
    return Promise.resolve(null);
  }

  createForUser(
    input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null> {
    this.createdName = input.name;
    return Promise.resolve(null);
  }

  updateForUser(
    _input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null> {
    return Promise.resolve(null);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("expense category trims its name", async () => {
  const repository = new FakeCategoryRepository();
  await new ExpenseCategoryService(repository).create({
    organizationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    name: " Pojištění ",
    isActive: true,
  });
  assert(repository.createdName === "Pojištění", "name was not normalized");
});

Deno.test("expense category rejects an invalid name", async () => {
  let rejected = false;
  try {
    await new ExpenseCategoryService(new FakeCategoryRepository()).create({
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      name: "x",
      isActive: true,
    });
  } catch (error) {
    rejected = error instanceof ExpenseCategoryValidationError;
  }
  assert(rejected, "invalid category was accepted");
});
