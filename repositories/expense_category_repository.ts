import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  ExpenseCategory,
  ExpenseCategoryInput,
} from "@/domain/expenses/types.ts";

interface ExpenseCategoryRow {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function fromRow(row: ExpenseCategoryRow): ExpenseCategory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ExpenseCategoryRepository {
  listForUser(
    organizationId: string,
    userId: string,
    includeInactive: boolean,
  ): Promise<ExpenseCategory[]>;
  findForUser(
    organizationId: string,
    categoryId: string,
    userId: string,
  ): Promise<ExpenseCategory | null>;
  createForUser(
    input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null>;
  updateForUser(
    input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null>;
}

const COLUMNS = `
  id, organization_id, name, is_active, created_at, updated_at
`;

export class PostgresExpenseCategoryRepository
  implements ExpenseCategoryRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(
    organizationId: string,
    userId: string,
    includeInactive: boolean,
  ): Promise<ExpenseCategory[]> {
    const rows = await this.sql<ExpenseCategoryRow[]>`
      SELECT categories.id, categories.organization_id, categories.name,
        categories.is_active, categories.created_at, categories.updated_at
      FROM expense_categories AS categories
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = categories.organization_id
      WHERE categories.organization_id = ${organizationId}
        AND memberships.user_id = ${userId}
        AND (${includeInactive} OR categories.is_active)
      ORDER BY categories.is_active DESC, lower(categories.name), categories.id
    `;
    return rows.map(fromRow);
  }

  async findForUser(
    organizationId: string,
    categoryId: string,
    userId: string,
  ): Promise<ExpenseCategory | null> {
    const rows = await this.sql<ExpenseCategoryRow[]>`
      SELECT categories.id, categories.organization_id, categories.name,
        categories.is_active, categories.created_at, categories.updated_at
      FROM expense_categories AS categories
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = categories.organization_id
      WHERE categories.id = ${categoryId}
        AND categories.organization_id = ${organizationId}
        AND memberships.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async createForUser(
    input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null> {
    const rows = await this.sql.unsafe<ExpenseCategoryRow[]>(
      `
      INSERT INTO expense_categories (id, organization_id, name, is_active)
      SELECT $1, $2, $3, $4
      FROM organization_memberships
      WHERE organization_id = $2 AND user_id = $5
      RETURNING ${COLUMNS}
    `,
      [
        input.id,
        input.organizationId,
        input.name,
        input.isActive,
        input.userId,
      ],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async updateForUser(
    input: ExpenseCategoryInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<ExpenseCategory | null> {
    const rows = await this.sql.unsafe<ExpenseCategoryRow[]>(
      `
      UPDATE expense_categories
      SET name = $1, is_active = $2, updated_at = now()
      WHERE id = $3 AND organization_id = $4
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = $4 AND user_id = $5
        )
      RETURNING ${COLUMNS}
    `,
      [
        input.name,
        input.isActive,
        input.id,
        input.organizationId,
        input.userId,
      ],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }
}
