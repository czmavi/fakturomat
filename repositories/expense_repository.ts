import { emptyExpenseDetails } from "@/domain/expenses/details.ts";
import { money } from "@/database/d1.ts";
import type { ExpenseAttachment } from "@/domain/expenses/attachment.ts";
import type { Sql, TransactionSql } from "@/database/d1.ts";
import { getDb } from "@/database/client.ts";
import type {
  Expense,
  ExpenseDocumentType,
  ExpenseSummary,
  ExpenseVatLine,
  NormalizedExpenseInput,
} from "@/domain/expenses/types.ts";
import { normalizeVatRate } from "@/domain/expenses/vat.ts";

interface ExpenseRow {
  invoice_details: string;
  id: string;
  organization_id: string;
  contact_id: string | null;
  contact_name: string | null;
  document_type: ExpenseDocumentType;
  supplier_name: string;
  supplier_invoice_number: string | null;
  issue_date: string | Date | null;
  taxable_supply_date: string | Date | null;
  due_date: string | Date | null;
  payment_date: string | Date | null;
  description: string;
  category_id: string | null;
  category_name: string | null;
  currency: string;
  total_amount: string;
  vat_base_total: string;
  vat_amount_total: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ExpenseVatLineRow {
  id: string;
  expense_id: string;
  position: number;
  vat_rate: string;
  base_amount: string;
  vat_amount: string;
}

function dateString(value: string | Date | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

function summaryFromRow(row: ExpenseRow): ExpenseSummary {
  return {
    details: {
      ...emptyExpenseDetails(),
      ...JSON.parse(row.invoice_details || "{}"),
    },
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    documentType: row.document_type,
    supplierName: row.supplier_name,
    supplierInvoiceNumber: row.supplier_invoice_number,
    issueDate: dateString(row.issue_date),
    taxableSupplyDate: dateString(row.taxable_supply_date),
    dueDate: dateString(row.due_date),
    paymentDate: dateString(row.payment_date),
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name,
    currency: row.currency,
    totalAmount: row.total_amount,
    vatBaseTotal: row.vat_base_total,
    vatAmountTotal: row.vat_amount_total,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function vatLineFromRow(row: ExpenseVatLineRow): ExpenseVatLine {
  return {
    id: row.id,
    expenseId: row.expense_id,
    position: row.position,
    vatRate: normalizeVatRate(row.vat_rate),
    baseAmount: row.base_amount,
    vatAmount: row.vat_amount,
  };
}

export interface ExpenseRepository {
  listForUser(input: {
    organizationId: string;
    userId: string;
    search: string;
    categoryId: string | null;
    documentType: ExpenseDocumentType | null;
  }): Promise<ExpenseSummary[]>;
  findForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<Expense | null>;
  createForUser(
    input: NormalizedExpenseInput & {
      attachment?: Omit<ExpenseAttachment, "createdAt">;
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null>;
  updateForUser(
    input: NormalizedExpenseInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null>;
}

const SELECT_COLUMNS = `
  expenses.id, expenses.organization_id, expenses.contact_id,
  contacts.name AS contact_name, expenses.document_type,
  expenses.supplier_name, expenses.supplier_invoice_number,
  expenses.issue_date, expenses.taxable_supply_date, expenses.due_date,
  expenses.payment_date, expenses.description, expenses.category_id,
  categories.name AS category_name, expenses.currency,
  expenses.total_amount,
  COALESCE((
    SELECT SUM(lines.base_amount)
    FROM expense_vat_lines AS lines
    WHERE lines.organization_id = expenses.organization_id
      AND lines.expense_id = expenses.id
  ), 0) AS vat_base_total,
  COALESCE((
    SELECT SUM(lines.vat_amount)
    FROM expense_vat_lines AS lines
    WHERE lines.organization_id = expenses.organization_id
      AND lines.expense_id = expenses.id
  ), 0) AS vat_amount_total,
  expenses.invoice_details, expenses.note, expenses.created_at, expenses.updated_at
`;

const JOINS = `
  LEFT JOIN contacts
    ON contacts.id = expenses.contact_id
    AND contacts.organization_id = expenses.organization_id
  LEFT JOIN expense_categories AS categories
    ON categories.id = expenses.category_id
    AND categories.organization_id = expenses.organization_id
  JOIN organization_memberships AS memberships
    ON memberships.organization_id = expenses.organization_id
`;

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll(
    "_",
    "\\_",
  );
}

export class D1ExpenseRepository implements ExpenseRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(input: {
    organizationId: string;
    userId: string;
    search: string;
    categoryId: string | null;
    documentType: ExpenseDocumentType | null;
  }): Promise<ExpenseSummary[]> {
    const search = input.search.trim();
    const pattern = `%${escapeLike(search)}%`;
    const rows = await this.sql.unsafe<ExpenseRow[]>(
      `
      SELECT ${SELECT_COLUMNS}
      FROM expenses
      ${JOINS}
      WHERE expenses.organization_id = $1
        AND memberships.user_id = $2
        AND ($3 IS NULL OR expenses.category_id = $3)
        AND ($4 IS NULL OR expenses.document_type = $4)
        AND (
          $5 = ''
          OR expenses.supplier_name LIKE $6 ESCAPE '\\'
          OR expenses.description LIKE $6 ESCAPE '\\'
          OR COALESCE(expenses.supplier_invoice_number, '') LIKE $6 ESCAPE '\\'
        )
      ORDER BY expenses.issue_date DESC NULLS LAST,
        expenses.created_at DESC, expenses.id
    `,
      [
        input.organizationId,
        input.userId,
        input.categoryId,
        input.documentType,
        search,
        pattern,
      ],
    );
    return rows.map(summaryFromRow);
  }

  async findForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<Expense | null> {
    const rows = await this.sql.unsafe<ExpenseRow[]>(
      `
      SELECT ${SELECT_COLUMNS}
      FROM expenses
      ${JOINS}
      WHERE expenses.id = $1 AND expenses.organization_id = $2
        AND memberships.user_id = $3
      LIMIT 1
    `,
      [expenseId, organizationId, userId],
    );
    if (!rows[0]) return null;
    const vatLines = await this.loadVatLines(
      this.sql,
      organizationId,
      expenseId,
    );
    return { ...summaryFromRow(rows[0]), vatLines };
  }

  async createForUser(
    input: NormalizedExpenseInput & {
      attachment?: Omit<ExpenseAttachment, "createdAt">;
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null> {
    return await this.sql.begin(async (transaction) => {
      if (!await this.referencesAreAvailable(transaction, input)) return null;
      transaction.queue(transaction`
        INSERT INTO expenses (
          id, organization_id, contact_id, document_type, supplier_name,
          supplier_invoice_number, issue_date, taxable_supply_date, due_date,
          payment_date, description, category_id, currency, total_amount, note, invoice_details
        ) VALUES (
          ${input.id}, ${input.organizationId}, ${input.contactId},
          ${input.documentType}, ${input.supplierName},
          ${input.supplierInvoiceNumber}, ${input.issueDate},
          ${input.taxableSupplyDate}, ${input.dueDate}, ${input.paymentDate},
          ${input.description}, ${input.categoryId}, ${input.currency},
          ${money(input.totalAmount)}, ${input.note}, ${
        JSON.stringify(input.details ?? emptyExpenseDetails())
      }
        )
      `);
      if (input.attachment) {
        const attachment = input.attachment;
        transaction.queue(transaction`
          INSERT INTO attachments (id, organization_id, expense_id, filename, mime_type, size, storage_key, sha256)
          VALUES (${attachment.id}, ${input.organizationId}, ${input.id}, ${attachment.filename},
            ${attachment.mimeType}, ${attachment.size}, ${attachment.storageKey}, ${attachment.sha256})
        `);
      }
      await this.insertVatLines(transaction, input);
      return transaction.after(() =>
        this.findInTransaction(this.sql as TransactionSql, input)
      );
    });
  }

  async updateForUser(
    input: NormalizedExpenseInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null> {
    return await this.sql.begin(async (transaction) => {
      const current = await transaction<{ id: string }[]>`
        SELECT expenses.id
        FROM expenses
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = expenses.organization_id
        WHERE expenses.id = ${input.id}
          AND expenses.organization_id = ${input.organizationId}
          AND memberships.user_id = ${input.userId}

      `;
      if (!current[0]) return null;
      if (!await this.referencesAreAvailable(transaction, input)) return null;
      transaction.queue(transaction`
        UPDATE expenses
        SET contact_id = ${input.contactId}, document_type = ${input.documentType},
          supplier_name = ${input.supplierName},
          supplier_invoice_number = ${input.supplierInvoiceNumber},
          issue_date = ${input.issueDate},
          taxable_supply_date = ${input.taxableSupplyDate},
          due_date = ${input.dueDate}, payment_date = ${input.paymentDate},
          description = ${input.description}, category_id = ${input.categoryId},
          currency = ${input.currency}, total_amount = ${
        money(input.totalAmount)
      },
          invoice_details = ${
        JSON.stringify(input.details ?? emptyExpenseDetails())
      },
          note = ${input.note}, updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
        WHERE id = ${input.id} AND organization_id = ${input.organizationId}
      `);
      transaction.queue(transaction`
        DELETE FROM expense_vat_lines
        WHERE organization_id = ${input.organizationId}
          AND expense_id = ${input.id}
      `);
      await this.insertVatLines(transaction, input);
      return transaction.after(() =>
        this.findInTransaction(this.sql as TransactionSql, input)
      );
    });
  }

  private async referencesAreAvailable(
    sql: TransactionSql,
    input: NormalizedExpenseInput & {
      organizationId: string;
      userId: string;
    },
  ): Promise<boolean> {
    const rows = await sql<{ allowed: boolean }[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        )
        AND (
          ${input.contactId} IS NULL OR EXISTS (
            SELECT 1 FROM contacts
            WHERE id = ${input.contactId}
              AND organization_id = ${input.organizationId}
          )
        )
        AND (
          ${input.categoryId} IS NULL OR EXISTS (
            SELECT 1 FROM expense_categories
            WHERE id = ${input.categoryId}
              AND organization_id = ${input.organizationId}
          )
        ) AS allowed
    `;
    return rows[0]?.allowed ?? false;
  }

  private insertVatLines(
    sql: TransactionSql,
    input: NormalizedExpenseInput & { id: string; organizationId: string },
  ): void {
    for (const line of input.vatLines) {
      sql.queue(sql`
        INSERT INTO expense_vat_lines (
          id, organization_id, expense_id, position, vat_rate,
          base_amount, vat_amount
        ) VALUES (
          ${line.id}, ${input.organizationId}, ${input.id}, ${line.position},
          ${line.vatRate}, ${money(line.baseAmount)}, ${money(line.vatAmount)}
        )
      `);
    }
  }

  private async loadVatLines(
    sql: Sql | TransactionSql,
    organizationId: string,
    expenseId: string,
  ): Promise<ExpenseVatLine[]> {
    const rows = await sql<ExpenseVatLineRow[]>`
      SELECT id, expense_id, position, vat_rate,
        base_amount, vat_amount
      FROM expense_vat_lines
      WHERE organization_id = ${organizationId} AND expense_id = ${expenseId}
      ORDER BY position
    `;
    return rows.map(vatLineFromRow);
  }

  private async findInTransaction(
    sql: TransactionSql,
    input: { organizationId: string; id: string; userId: string },
  ): Promise<Expense | null> {
    const rows = await sql.unsafe<ExpenseRow[]>(
      `
      SELECT ${SELECT_COLUMNS}
      FROM expenses
      ${JOINS}
      WHERE expenses.id = $1 AND expenses.organization_id = $2
        AND memberships.user_id = $3
      LIMIT 1
    `,
      [input.id, input.organizationId, input.userId],
    );
    if (!rows[0]) return null;
    const vatLines = await this.loadVatLines(
      sql,
      input.organizationId,
      input.id,
    );
    return { ...summaryFromRow(rows[0]), vatLines };
  }
}
