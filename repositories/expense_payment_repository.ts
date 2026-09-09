import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  ExpensePayment,
  PaymentExpenseCandidate,
} from "@/domain/banking/types.ts";

interface ExpensePaymentRow {
  id: string;
  organization_id: string;
  expense_id: string;
  expense_supplier_name: string;
  expense_document_number: string | null;
  bank_transaction_id: string;
  amount: string;
  created_by: string | null;
  created_at: Date;
}

interface ExpenseCandidateRow {
  id: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  description: string;
  currency: string;
  total_amount: string;
  paid_amount: string;
  remaining_amount: string;
}

function paymentFromRow(row: ExpensePaymentRow): ExpensePayment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    expenseId: row.expense_id,
    expenseSupplierName: row.expense_supplier_name,
    expenseDocumentNumber: row.expense_document_number,
    bankTransactionId: row.bank_transaction_id,
    amount: row.amount,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function candidateFromRow(row: ExpenseCandidateRow): PaymentExpenseCandidate {
  return {
    id: row.id,
    supplierName: row.supplier_name,
    supplierInvoiceNumber: row.supplier_invoice_number,
    description: row.description,
    currency: row.currency,
    totalAmount: row.total_amount,
    paidAmount: row.paid_amount,
    remainingAmount: row.remaining_amount,
  };
}

export type ManualExpenseMatchResult =
  | { kind: "matched"; payment: ExpensePayment }
  | { kind: "not_found" }
  | { kind: "not_matchable" };

export interface ExpensePaymentRepository {
  manualMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankTransactionId: string;
    expenseId: string;
  }): Promise<ManualExpenseMatchResult>;
  unmatchForUser(input: {
    organizationId: string;
    userId: string;
    paymentId: string;
  }): Promise<boolean>;
  listForTransactionIdsForUser(
    organizationId: string,
    transactionIds: string[],
    userId: string,
  ): Promise<ExpensePayment[]>;
  listForExpenseForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<ExpensePayment[]>;
  listOpenExpenseCandidatesForUser(
    organizationId: string,
    userId: string,
  ): Promise<PaymentExpenseCandidate[]>;
}

const PAYMENT_SELECT = `
  expense_payments.id, expense_payments.organization_id,
  expense_payments.expense_id,
  expenses.supplier_name AS expense_supplier_name,
  expenses.supplier_invoice_number AS expense_document_number,
  expense_payments.bank_transaction_id, expense_payments.amount::text,
  expense_payments.created_by, expense_payments.created_at
`;

export class PostgresExpensePaymentRepository
  implements ExpensePaymentRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async manualMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankTransactionId: string;
    expenseId: string;
  }): Promise<ManualExpenseMatchResult> {
    return await this.sql.begin(async (transaction) => {
      const access = await transaction<{ allowed: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        ) AS allowed
      `;
      if (!access[0].allowed) return { kind: "not_found" };

      const bankTransactions = await transaction<
        Array<{ amount: string; currency: string }>
      >`
        SELECT (-amount)::text AS amount, currency
        FROM bank_transactions
        WHERE id = ${input.bankTransactionId}
          AND organization_id = ${input.organizationId}
          AND amount < 0
        FOR UPDATE
      `;
      const expenses = await transaction<
        Array<{
          total_amount: string;
          currency: string;
          supplier_name: string;
          supplier_invoice_number: string | null;
        }>
      >`
        SELECT total_amount::text, currency, supplier_name,
          supplier_invoice_number
        FROM expenses
        WHERE id = ${input.expenseId}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      const bankTransaction = bankTransactions[0];
      const expense = expenses[0];
      if (!bankTransaction || !expense) return { kind: "not_found" };
      if (bankTransaction.currency !== expense.currency) {
        return { kind: "not_matchable" };
      }

      const amounts = await transaction<
        Array<{ transaction_remaining: string; expense_remaining: string }>
      >`
        SELECT
          (${bankTransaction.amount}::numeric - COALESCE((
            SELECT SUM(amount) FROM expense_payments
            WHERE bank_transaction_id = ${input.bankTransactionId}
          ), 0))::text AS transaction_remaining,
          (${expense.total_amount}::numeric - COALESCE((
            SELECT SUM(amount) FROM expense_payments
            WHERE expense_id = ${input.expenseId}
          ), 0))::text AS expense_remaining
      `;
      const inserted = await transaction<ExpensePaymentRow[]>`
        INSERT INTO expense_payments (
          id, organization_id, expense_id, bank_transaction_id, amount,
          created_by
        )
        SELECT ${crypto.randomUUID()}, ${input.organizationId},
          ${input.expenseId}, ${input.bankTransactionId},
          LEAST(
            ${amounts[0].transaction_remaining}::numeric,
            ${amounts[0].expense_remaining}::numeric
          ), ${input.userId}
        WHERE ${amounts[0].transaction_remaining}::numeric > 0
          AND ${amounts[0].expense_remaining}::numeric > 0
        ON CONFLICT (expense_id, bank_transaction_id) DO NOTHING
        RETURNING id, organization_id, expense_id,
          ${expense.supplier_name}::text AS expense_supplier_name,
          ${expense.supplier_invoice_number}::text AS expense_document_number,
          bank_transaction_id, amount::text, created_by, created_at
      `;
      return inserted[0]
        ? { kind: "matched", payment: paymentFromRow(inserted[0]) }
        : { kind: "not_matchable" };
    });
  }

  async unmatchForUser(input: {
    organizationId: string;
    userId: string;
    paymentId: string;
  }): Promise<boolean> {
    return await this.sql.begin(async (transaction) => {
      const paymentReferences = await transaction<
        Array<{
          id: string;
          expense_id: string;
          bank_transaction_id: string;
        }>
      >`
        SELECT expense_payments.id, expense_payments.expense_id,
          expense_payments.bank_transaction_id
        FROM expense_payments
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = expense_payments.organization_id
        WHERE expense_payments.id = ${input.paymentId}
          AND expense_payments.organization_id = ${input.organizationId}
          AND memberships.user_id = ${input.userId}
      `;
      const payment = paymentReferences[0];
      if (!payment) return false;
      await transaction`
        SELECT id FROM bank_transactions
        WHERE id = ${payment.bank_transaction_id}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      await transaction`
        SELECT id FROM expenses
        WHERE id = ${payment.expense_id}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      const lockedPayments = await transaction<{ id: string }[]>`
        SELECT id FROM expense_payments
        WHERE id = ${payment.id}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      if (!lockedPayments[0]) return false;
      await transaction`
        DELETE FROM expense_payments
        WHERE id = ${payment.id}
          AND organization_id = ${input.organizationId}
      `;
      return true;
    });
  }

  async listForTransactionIdsForUser(
    organizationId: string,
    transactionIds: string[],
    userId: string,
  ): Promise<ExpensePayment[]> {
    if (transactionIds.length === 0) return [];
    const placeholders = transactionIds.map((_, index) => `$${index + 3}`)
      .join(", ");
    const rows = await this.sql.unsafe<ExpensePaymentRow[]>(
      `
        SELECT ${PAYMENT_SELECT}
        FROM expense_payments
        JOIN expenses
          ON expenses.id = expense_payments.expense_id
          AND expenses.organization_id = expense_payments.organization_id
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = expense_payments.organization_id
        WHERE expense_payments.organization_id = $1
          AND memberships.user_id = $2
          AND expense_payments.bank_transaction_id IN (${placeholders})
        ORDER BY expense_payments.created_at, expense_payments.id
      `,
      [organizationId, userId, ...transactionIds],
    );
    return rows.map(paymentFromRow);
  }

  async listForExpenseForUser(
    organizationId: string,
    expenseId: string,
    userId: string,
  ): Promise<ExpensePayment[]> {
    const rows = await this.sql.unsafe<ExpensePaymentRow[]>(
      `
        SELECT ${PAYMENT_SELECT}
        FROM expense_payments
        JOIN expenses
          ON expenses.id = expense_payments.expense_id
          AND expenses.organization_id = expense_payments.organization_id
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = expense_payments.organization_id
        WHERE expense_payments.organization_id = $1
          AND expense_payments.expense_id = $2
          AND memberships.user_id = $3
        ORDER BY expense_payments.created_at, expense_payments.id
      `,
      [organizationId, expenseId, userId],
    );
    return rows.map(paymentFromRow);
  }

  async listOpenExpenseCandidatesForUser(
    organizationId: string,
    userId: string,
  ): Promise<PaymentExpenseCandidate[]> {
    const rows = await this.sql<ExpenseCandidateRow[]>`
      SELECT expenses.id, expenses.supplier_name,
        expenses.supplier_invoice_number, expenses.description,
        expenses.currency, expenses.total_amount::text,
        COALESCE(SUM(expense_payments.amount), 0)::text AS paid_amount,
        (expenses.total_amount - COALESCE(SUM(expense_payments.amount), 0))::text
          AS remaining_amount
      FROM expenses
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = expenses.organization_id
      LEFT JOIN expense_payments
        ON expense_payments.expense_id = expenses.id
        AND expense_payments.organization_id = expenses.organization_id
      WHERE expenses.organization_id = ${organizationId}
        AND memberships.user_id = ${userId}
      GROUP BY expenses.id
      HAVING expenses.total_amount > COALESCE(SUM(expense_payments.amount), 0)
      ORDER BY expenses.due_date NULLS LAST, expenses.issue_date NULLS LAST,
        expenses.created_at, expenses.id
      LIMIT 500
    `;
    return rows.map(candidateFromRow);
  }
}
