import type {
  ExpenseCategory,
  ExpenseCategoryInput,
} from "@/domain/expenses/types.ts";
import type { ExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";

export class ExpenseCategoryValidationError extends Error {}

function normalize(input: ExpenseCategoryInput): ExpenseCategoryInput {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) {
    throw new ExpenseCategoryValidationError(
      "Název kategorie musí mít 2 až 100 znaků.",
    );
  }
  return { name, isActive: input.isActive };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === "23505";
}

export class ExpenseCategoryService {
  constructor(private readonly repository: ExpenseCategoryRepository) {}

  async create(
    input: ExpenseCategoryInput & { organizationId: string; userId: string },
  ): Promise<ExpenseCategory | null> {
    try {
      return await this.repository.createForUser({
        ...normalize(input),
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ExpenseCategoryValidationError(
          "Kategorie s tímto názvem už existuje.",
        );
      }
      throw error;
    }
  }

  async update(
    input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null> {
    try {
      return await this.repository.updateForUser({
        ...normalize(input),
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ExpenseCategoryValidationError(
          "Kategorie s tímto názvem už existuje.",
        );
      }
      throw error;
    }
  }
}
