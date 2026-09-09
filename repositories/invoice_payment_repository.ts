import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  InvoicePayment,
  InvoicePaymentMatchType,
  PaymentInvoiceCandidate,
} from "@/domain/banking/types.ts";

interface PaymentRow {
  id: string;
  organization_id: string;
  invoice_id: string;
  invoice_number: string;
  bank_transaction_id: string;
  amount: string;
  match_type: InvoicePaymentMatchType;
  created_by: string | null;
  created_at: Date;
}

interface CandidateRow {
  id: string;
  number: string;
  contact_name: string;
  variable_symbol: string | null;
  currency: string;
  total: string;
  paid_amount: string;
  remaining_amount: string;
}

function paymentFromRow(row: PaymentRow): InvoicePayment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    bankTransactionId: row.bank_transaction_id,
    amount: row.amount,
    matchType: row.match_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function candidateFromRow(row: CandidateRow): PaymentInvoiceCandidate {
  return {
    id: row.id,
    number: row.number,
    contactName: row.contact_name,
    variableSymbol: row.variable_symbol,
    currency: row.currency,
    total: row.total,
    paidAmount: row.paid_amount,
    remainingAmount: row.remaining_amount,
  };
}

export type ManualInvoiceMatchResult =
  | { kind: "matched"; payment: InvoicePayment }
  | { kind: "not_found" }
  | { kind: "not_matchable" };

export interface InvoicePaymentRepository {
  autoMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankAccountId: string | null;
  }): Promise<number | null>;
  manualMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankTransactionId: string;
    invoiceId: string;
  }): Promise<ManualInvoiceMatchResult>;
  unmatchForUser(input: {
    organizationId: string;
    userId: string;
    paymentId: string;
  }): Promise<boolean>;
  listForTransactionIdsForUser(
    organizationId: string,
    transactionIds: string[],
    userId: string,
  ): Promise<InvoicePayment[]>;
  listForInvoiceForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<InvoicePayment[]>;
  listOpenInvoiceCandidatesForUser(
    organizationId: string,
    userId: string,
  ): Promise<PaymentInvoiceCandidate[]>;
}

const PAYMENT_SELECT = `
  invoice_payments.id, invoice_payments.organization_id,
  invoice_payments.invoice_id, invoices.number AS invoice_number,
  invoice_payments.bank_transaction_id, invoice_payments.amount::text,
  invoice_payments.match_type, invoice_payments.created_by,
  invoice_payments.created_at
`;

export class PostgresInvoicePaymentRepository
  implements InvoicePaymentRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async autoMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankAccountId: string | null;
  }): Promise<number | null> {
    return await this.sql.begin(async (transaction) => {
      const access = await transaction<{ allowed: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        ) AS allowed
      `;
      if (!access[0].allowed) return null;
      const bankTransactions = await transaction<
        Array<{
          id: string;
          variable_symbol: string;
          currency: string;
          amount: string;
          booking_date: string;
        }>
      >`
        SELECT bank_transactions.id, bank_transactions.variable_symbol,
          bank_transactions.currency, bank_transactions.amount::text,
          bank_transactions.booking_date::text
        FROM bank_transactions
        WHERE bank_transactions.organization_id = ${input.organizationId}
          AND (${input.bankAccountId}::uuid IS NULL
            OR bank_transactions.bank_account_id = ${input.bankAccountId})
          AND bank_transactions.amount > 0
          AND bank_transactions.variable_symbol IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM invoice_payments
            WHERE invoice_payments.bank_transaction_id = bank_transactions.id
          )
        ORDER BY bank_transactions.booking_date, bank_transactions.id
        FOR UPDATE OF bank_transactions SKIP LOCKED
      `;

      let matched = 0;
      for (const bankTransaction of bankTransactions) {
        const invoices = await transaction<
          Array<{ id: string; total: string }>
        >`
          SELECT invoices.id, invoices.total::text
          FROM invoices
          WHERE invoices.organization_id = ${input.organizationId}
            AND invoices.status = 'ISSUED'
            AND invoices.variable_symbol = ${bankTransaction.variable_symbol}
            AND invoices.currency = ${bankTransaction.currency}
            AND invoices.total = ${bankTransaction.amount}
            AND NOT EXISTS (
              SELECT 1 FROM invoice_payments
              WHERE invoice_payments.invoice_id = invoices.id
            )
          ORDER BY invoices.issue_date, invoices.id
          LIMIT 2
          FOR UPDATE OF invoices SKIP LOCKED
        `;
        if (invoices.length !== 1) continue;
        await transaction`
          INSERT INTO invoice_payments (
            id, organization_id, invoice_id, bank_transaction_id, amount,
            match_type, created_by
          ) VALUES (
            ${crypto.randomUUID()}, ${input.organizationId}, ${invoices[0].id},
            ${bankTransaction.id}, ${invoices[0].total}, 'AUTO', NULL
          )
        `;
        await transaction`
          UPDATE invoices
          SET status = 'PAID', paid_at = ${bankTransaction.booking_date}::date,
            updated_at = now()
          WHERE id = ${invoices[0].id}
            AND organization_id = ${input.organizationId}
            AND status = 'ISSUED'
        `;
        matched++;
      }
      return matched;
    });
  }

  async manualMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankTransactionId: string;
    invoiceId: string;
  }): Promise<ManualInvoiceMatchResult> {
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
        Array<{
          amount: string;
          currency: string;
          booking_date: string;
        }>
      >`
        SELECT amount::text, currency, booking_date::text
        FROM bank_transactions
        WHERE id = ${input.bankTransactionId}
          AND organization_id = ${input.organizationId}
          AND amount > 0
        FOR UPDATE
      `;
      const invoices = await transaction<
        Array<{ total: string; currency: string; number: string }>
      >`
        SELECT total::text, currency, number
        FROM invoices
        WHERE id = ${input.invoiceId}
          AND organization_id = ${input.organizationId}
          AND status = 'ISSUED'
        FOR UPDATE
      `;
      const bankTransaction = bankTransactions[0];
      const invoice = invoices[0];
      if (!bankTransaction || !invoice) return { kind: "not_found" };
      if (bankTransaction.currency !== invoice.currency) {
        return { kind: "not_matchable" };
      }

      const amounts = await transaction<
        Array<{ transaction_remaining: string; invoice_remaining: string }>
      >`
        SELECT
          (${bankTransaction.amount}::numeric - COALESCE((
            SELECT SUM(amount) FROM invoice_payments
            WHERE bank_transaction_id = ${input.bankTransactionId}
          ), 0))::text AS transaction_remaining,
          (${invoice.total}::numeric - COALESCE((
            SELECT SUM(amount) FROM invoice_payments
            WHERE invoice_id = ${input.invoiceId}
          ), 0))::text AS invoice_remaining
      `;
      const inserted = await transaction<PaymentRow[]>`
        INSERT INTO invoice_payments (
          id, organization_id, invoice_id, bank_transaction_id, amount,
          match_type, created_by
        )
        SELECT ${crypto.randomUUID()}, ${input.organizationId},
          ${input.invoiceId}, ${input.bankTransactionId},
          LEAST(
            ${amounts[0].transaction_remaining}::numeric,
            ${amounts[0].invoice_remaining}::numeric
          ), 'MANUAL', ${input.userId}
        WHERE ${amounts[0].transaction_remaining}::numeric > 0
          AND ${amounts[0].invoice_remaining}::numeric > 0
        ON CONFLICT (invoice_id, bank_transaction_id) DO NOTHING
        RETURNING id, organization_id, invoice_id,
          ${invoice.number}::text AS invoice_number,
          bank_transaction_id, amount::text, match_type, created_by, created_at
      `;
      if (!inserted[0]) return { kind: "not_matchable" };

      await transaction`
        UPDATE invoices
        SET status = CASE
              WHEN (
                SELECT COALESCE(SUM(amount), 0) FROM invoice_payments
                WHERE invoice_id = ${input.invoiceId}
              ) >= total THEN 'PAID'
              ELSE 'ISSUED'
            END,
          paid_at = CASE
            WHEN (
              SELECT COALESCE(SUM(amount), 0) FROM invoice_payments
              WHERE invoice_id = ${input.invoiceId}
            ) >= total THEN ${bankTransaction.booking_date}::date
            ELSE NULL
          END,
          updated_at = now()
        WHERE id = ${input.invoiceId}
          AND organization_id = ${input.organizationId}
      `;
      return { kind: "matched", payment: paymentFromRow(inserted[0]) };
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
          invoice_id: string;
          bank_transaction_id: string;
        }>
      >`
        SELECT invoice_payments.id, invoice_payments.invoice_id,
          invoice_payments.bank_transaction_id
        FROM invoice_payments
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = invoice_payments.organization_id
        WHERE invoice_payments.id = ${input.paymentId}
          AND invoice_payments.organization_id = ${input.organizationId}
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
        SELECT id FROM invoices
        WHERE id = ${payment.invoice_id}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      const lockedPayments = await transaction<{ id: string }[]>`
        SELECT id FROM invoice_payments
        WHERE id = ${payment.id}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      if (!lockedPayments[0]) return false;
      await transaction`
        DELETE FROM invoice_payments
        WHERE id = ${payment.id}
          AND organization_id = ${input.organizationId}
      `;
      await transaction`
        UPDATE invoices
        SET status = CASE
              WHEN (
                SELECT COALESCE(SUM(amount), 0) FROM invoice_payments
                WHERE invoice_id = ${payment.invoice_id}
              ) >= total THEN 'PAID'
              ELSE 'ISSUED'
            END,
          paid_at = CASE
            WHEN (
              SELECT COALESCE(SUM(amount), 0) FROM invoice_payments
              WHERE invoice_id = ${payment.invoice_id}
            ) >= total THEN paid_at
            ELSE NULL
          END,
          updated_at = now()
        WHERE id = ${payment.invoice_id}
          AND organization_id = ${input.organizationId}
          AND status IN ('ISSUED', 'PAID')
      `;
      return true;
    });
  }

  async listForTransactionIdsForUser(
    organizationId: string,
    transactionIds: string[],
    userId: string,
  ): Promise<InvoicePayment[]> {
    if (transactionIds.length === 0) return [];
    const placeholders = transactionIds.map((_, index) => `$${index + 3}`)
      .join(", ");
    const rows = await this.sql.unsafe<PaymentRow[]>(
      `
        SELECT ${PAYMENT_SELECT}
        FROM invoice_payments
        JOIN invoices
          ON invoices.id = invoice_payments.invoice_id
          AND invoices.organization_id = invoice_payments.organization_id
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = invoice_payments.organization_id
        WHERE invoice_payments.organization_id = $1
          AND memberships.user_id = $2
          AND invoice_payments.bank_transaction_id IN (${placeholders})
        ORDER BY invoice_payments.created_at, invoice_payments.id
      `,
      [organizationId, userId, ...transactionIds],
    );
    return rows.map(paymentFromRow);
  }

  async listForInvoiceForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<InvoicePayment[]> {
    const rows = await this.sql.unsafe<PaymentRow[]>(
      `
        SELECT ${PAYMENT_SELECT}
        FROM invoice_payments
        JOIN invoices
          ON invoices.id = invoice_payments.invoice_id
          AND invoices.organization_id = invoice_payments.organization_id
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = invoice_payments.organization_id
        WHERE invoice_payments.organization_id = $1
          AND invoice_payments.invoice_id = $2
          AND memberships.user_id = $3
        ORDER BY invoice_payments.created_at, invoice_payments.id
      `,
      [organizationId, invoiceId, userId],
    );
    return rows.map(paymentFromRow);
  }

  async listOpenInvoiceCandidatesForUser(
    organizationId: string,
    userId: string,
  ): Promise<PaymentInvoiceCandidate[]> {
    const rows = await this.sql<CandidateRow[]>`
      SELECT invoices.id, invoices.number,
        COALESCE(invoices.customer_snapshot->>'name', contacts.name)
          AS contact_name,
        invoices.variable_symbol, invoices.currency, invoices.total::text,
        COALESCE(SUM(invoice_payments.amount), 0)::text AS paid_amount,
        (invoices.total - COALESCE(SUM(invoice_payments.amount), 0))::text
          AS remaining_amount
      FROM invoices
      JOIN contacts
        ON contacts.id = invoices.contact_id
        AND contacts.organization_id = invoices.organization_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = invoices.organization_id
      LEFT JOIN invoice_payments
        ON invoice_payments.invoice_id = invoices.id
        AND invoice_payments.organization_id = invoices.organization_id
      WHERE invoices.organization_id = ${organizationId}
        AND memberships.user_id = ${userId}
        AND invoices.status = 'ISSUED'
      GROUP BY invoices.id, contacts.name
      HAVING invoices.total > COALESCE(SUM(invoice_payments.amount), 0)
      ORDER BY invoices.due_date, invoices.issue_date, invoices.id
      LIMIT 500
    `;
    return rows.map(candidateFromRow);
  }
}
