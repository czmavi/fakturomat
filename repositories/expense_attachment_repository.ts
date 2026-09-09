import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  ExpenseAttachment,
  ExpenseAttachmentMimeType,
} from "@/domain/expenses/attachment.ts";

interface AttachmentRow {
  id: string;
  organization_id: string;
  expense_id: string;
  filename: string;
  mime_type: ExpenseAttachmentMimeType;
  size: string;
  storage_key: string;
  sha256: string;
  created_at: Date;
}

function fromRow(row: AttachmentRow): ExpenseAttachment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    expenseId: row.expense_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: Number(row.size),
    storageKey: row.storage_key,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

export interface ExpenseAttachmentRepository {
  expenseExistsForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<boolean>;
  listForExpenseForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<ExpenseAttachment[]>;
  findForUser(
    organizationId: string,
    expenseId: string,
    attachmentId: string,
    userId: string,
  ): Promise<ExpenseAttachment | null>;
  createForUser(
    input: Omit<ExpenseAttachment, "createdAt"> & { userId: string },
  ): Promise<ExpenseAttachment | null>;
  deleteForUser(
    organizationId: string,
    expenseId: string,
    attachmentId: string,
    userId: string,
  ): Promise<ExpenseAttachment | null>;
}

const COLUMNS = `
  id, organization_id, expense_id, filename, mime_type, size::text,
  storage_key, sha256, created_at
`;

export class PostgresExpenseAttachmentRepository
  implements ExpenseAttachmentRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async expenseExistsForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM expenses
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = expenses.organization_id
        WHERE expenses.id = ${expenseId}
          AND expenses.organization_id = ${organizationId}
          AND memberships.user_id = ${userId}
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  }

  async listForExpenseForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<ExpenseAttachment[]> {
    const rows = await this.sql.unsafe<AttachmentRow[]>(
      `
      SELECT attachments.id, attachments.organization_id,
        attachments.expense_id, attachments.filename, attachments.mime_type,
        attachments.size::text, attachments.storage_key,
        attachments.sha256, attachments.created_at
      FROM attachments
      JOIN expenses
        ON expenses.id = attachments.expense_id
        AND expenses.organization_id = attachments.organization_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = attachments.organization_id
      WHERE attachments.organization_id = $1
        AND attachments.expense_id = $2
        AND memberships.user_id = $3
      ORDER BY attachments.created_at, attachments.id
    `,
      [organizationId, expenseId, userId],
    );
    return rows.map(fromRow);
  }

  async findForUser(
    organizationId: string,
    expenseId: string,
    attachmentId: string,
    userId: string,
  ): Promise<ExpenseAttachment | null> {
    const rows = await this.sql.unsafe<AttachmentRow[]>(
      `
      SELECT attachments.id, attachments.organization_id,
        attachments.expense_id, attachments.filename, attachments.mime_type,
        attachments.size::text, attachments.storage_key,
        attachments.sha256, attachments.created_at
      FROM attachments
      JOIN expenses
        ON expenses.id = attachments.expense_id
        AND expenses.organization_id = attachments.organization_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = attachments.organization_id
      WHERE attachments.id = $1
        AND attachments.organization_id = $2
        AND attachments.expense_id = $3
        AND memberships.user_id = $4
      LIMIT 1
    `,
      [attachmentId, organizationId, expenseId, userId],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async createForUser(
    input: Omit<ExpenseAttachment, "createdAt"> & { userId: string },
  ): Promise<ExpenseAttachment | null> {
    const rows = await this.sql.unsafe<AttachmentRow[]>(
      `
      INSERT INTO attachments (
        id, organization_id, expense_id, filename, mime_type, size,
        storage_key, sha256
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8
      FROM expenses
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = expenses.organization_id
      WHERE expenses.id = $3
        AND expenses.organization_id = $2
        AND memberships.user_id = $9
      RETURNING ${COLUMNS}
    `,
      [
        input.id,
        input.organizationId,
        input.expenseId,
        input.filename,
        input.mimeType,
        input.size,
        input.storageKey,
        input.sha256,
        input.userId,
      ],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async deleteForUser(
    organizationId: string,
    expenseId: string,
    attachmentId: string,
    userId: string,
  ): Promise<ExpenseAttachment | null> {
    const rows = await this.sql.unsafe<AttachmentRow[]>(
      `
      DELETE FROM attachments
      WHERE id = $1 AND organization_id = $2 AND expense_id = $3
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = $2 AND user_id = $4
        )
      RETURNING ${COLUMNS}
    `,
      [attachmentId, organizationId, expenseId, userId],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }
}
