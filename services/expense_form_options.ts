import type { ExpenseFormOptions } from "@/components/ExpenseForm.tsx";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import { PostgresExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";

export async function loadExpenseFormOptions(
  organizationId: string,
  userId: string,
): Promise<ExpenseFormOptions> {
  const [contacts, categories] = await Promise.all([
    new PostgresContactRepository().listForUser({
      organizationId,
      userId,
      search: "",
      includeArchived: true,
    }),
    new PostgresExpenseCategoryRepository().listForUser(
      organizationId,
      userId,
      true,
    ),
  ]);
  return { contacts, categories };
}
