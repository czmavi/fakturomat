import type { ExpenseFormOptions } from "@/components/ExpenseForm.tsx";
import { D1ContactRepository } from "@/repositories/contact_repository.ts";
import { D1ExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";

export async function loadExpenseFormOptions(
  organizationId: string,
  userId: string,
): Promise<ExpenseFormOptions> {
  const [contacts, categories] = await Promise.all([
    new D1ContactRepository().listForUser({
      organizationId,
      userId,
      search: "",
      includeArchived: true,
    }),
    new D1ExpenseCategoryRepository().listForUser(
      organizationId,
      userId,
      true,
    ),
  ]);
  return { contacts, categories };
}
