import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  CurrencyAmount,
  DashboardBankBalance,
  DashboardOverview,
} from "@/domain/dashboard/types.ts";

interface AggregateRow {
  currency: string;
  count: number;
  amount: string;
}

interface OutstandingRow extends AggregateRow {
  overdue_count: number;
  overdue_amount: string;
}

interface BalanceRow {
  bank_account_id: string;
  bank_account_name: string;
  amount: string;
  currency: string;
  date: string;
}

interface UnmatchedRow {
  total_count: number;
  incoming_count: number;
  outgoing_count: number;
}

function totals(
  rows: Array<{ currency: string; amount: string }>,
): CurrencyAmount[] {
  return rows.map((row) => ({ currency: row.currency, amount: row.amount }));
}

export interface DashboardRepository {
  getForUser(input: {
    organizationId: string;
    userId: string;
    dateFrom: string;
    dateTo: string;
    today: string;
  }): Promise<DashboardOverview | null>;
}

export class PostgresDashboardRepository implements DashboardRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async getForUser(input: {
    organizationId: string;
    userId: string;
    dateFrom: string;
    dateTo: string;
    today: string;
  }): Promise<DashboardOverview | null> {
    return await this.sql.begin(async (transaction) => {
      const memberships = await transaction<{ organization_id: string }[]>`
        SELECT organization_id
        FROM organization_memberships
        WHERE organization_id = ${input.organizationId}
          AND user_id = ${input.userId}
        FOR SHARE
      `;
      if (!memberships[0]) return null;

      const bankBalances = await transaction<BalanceRow[]>`
        SELECT bank_accounts.id AS bank_account_id,
          bank_accounts.name AS bank_account_name,
          bank_connections.current_balance::text AS amount,
          bank_connections.balance_currency AS currency,
          bank_connections.balance_date::text AS date
        FROM bank_connections
        JOIN bank_accounts
          ON bank_accounts.id = bank_connections.bank_account_id
          AND bank_accounts.organization_id = bank_connections.organization_id
        WHERE bank_connections.organization_id = ${input.organizationId}
          AND bank_connections.status <> 'DISABLED'
          AND bank_connections.current_balance IS NOT NULL
        ORDER BY bank_accounts.is_default DESC, bank_accounts.name,
          bank_accounts.id
      `;
      const issuedInvoices = await transaction<AggregateRow[]>`
        SELECT currency, count(*)::integer AS count,
          SUM(total)::text AS amount
        FROM invoices
        WHERE organization_id = ${input.organizationId}
          AND status IN ('ISSUED', 'PAID')
          AND issue_date BETWEEN ${input.dateFrom}::date AND ${input.dateTo}::date
        GROUP BY currency
        ORDER BY currency
      `;
      const outstandingInvoices = await transaction<OutstandingRow[]>`
        WITH outstanding AS (
          SELECT invoices.id, invoices.currency, invoices.due_date,
            invoices.total - COALESCE(SUM(invoice_payments.amount), 0)
              AS remaining
          FROM invoices
          LEFT JOIN invoice_payments
            ON invoice_payments.invoice_id = invoices.id
            AND invoice_payments.organization_id = invoices.organization_id
          WHERE invoices.organization_id = ${input.organizationId}
            AND invoices.status = 'ISSUED'
          GROUP BY invoices.id
        )
        SELECT currency, count(*)::integer AS count,
          SUM(remaining)::text AS amount,
          count(*) FILTER (WHERE due_date < ${input.today}::date)::integer
            AS overdue_count,
          COALESCE(
            SUM(remaining) FILTER (WHERE due_date < ${input.today}::date), 0
          )::text AS overdue_amount
        FROM outstanding
        WHERE remaining > 0
        GROUP BY currency
        ORDER BY currency
      `;
      const income = await transaction<AggregateRow[]>`
        SELECT currency, count(*)::integer AS count,
          SUM(amount)::text AS amount
        FROM bank_transactions
        WHERE organization_id = ${input.organizationId}
          AND booking_date BETWEEN ${input.dateFrom}::date AND ${input.dateTo}::date
          AND amount > 0
        GROUP BY currency
        ORDER BY currency
      `;
      const expenses = await transaction<AggregateRow[]>`
        SELECT currency, count(*)::integer AS count,
          SUM(total_amount)::text AS amount
        FROM expenses
        WHERE organization_id = ${input.organizationId}
          AND COALESCE(issue_date, created_at::date)
            BETWEEN ${input.dateFrom}::date AND ${input.dateTo}::date
        GROUP BY currency
        ORDER BY currency
      `;
      const cashflow = await transaction<AggregateRow[]>`
        SELECT currency, count(*)::integer AS count,
          SUM(amount)::text AS amount
        FROM bank_transactions
        WHERE organization_id = ${input.organizationId}
          AND booking_date BETWEEN ${input.dateFrom}::date AND ${input.dateTo}::date
        GROUP BY currency
        ORDER BY currency
      `;
      const unmatched = await transaction<UnmatchedRow[]>`
        WITH transaction_allocations AS (
          SELECT bank_transactions.id, bank_transactions.amount,
            CASE
              WHEN bank_transactions.amount > 0 THEN
                bank_transactions.amount - COALESCE((
                  SELECT SUM(invoice_payments.amount)
                  FROM invoice_payments
                  WHERE invoice_payments.bank_transaction_id =
                    bank_transactions.id
                    AND invoice_payments.organization_id =
                      bank_transactions.organization_id
                ), 0)
              WHEN bank_transactions.amount < 0 THEN
                -bank_transactions.amount - COALESCE((
                  SELECT SUM(expense_payments.amount)
                  FROM expense_payments
                  WHERE expense_payments.bank_transaction_id =
                    bank_transactions.id
                    AND expense_payments.organization_id =
                      bank_transactions.organization_id
                ), 0)
              ELSE 0
            END AS remaining
          FROM bank_transactions
          WHERE bank_transactions.organization_id = ${input.organizationId}
            AND bank_transactions.booking_date
              BETWEEN ${input.dateFrom}::date AND ${input.dateTo}::date
        )
        SELECT count(*) FILTER (WHERE remaining > 0)::integer AS total_count,
          count(*) FILTER (WHERE amount > 0 AND remaining > 0)::integer
            AS incoming_count,
          count(*) FILTER (WHERE amount < 0 AND remaining > 0)::integer
            AS outgoing_count
        FROM transaction_allocations
      `;

      return {
        bankBalances: bankBalances.map((row): DashboardBankBalance => ({
          bankAccountId: row.bank_account_id,
          bankAccountName: row.bank_account_name,
          amount: row.amount,
          currency: row.currency,
          date: row.date,
        })),
        issuedInvoiceCount: issuedInvoices.reduce(
          (sum, row) => sum + row.count,
          0,
        ),
        issuedInvoiceTotals: totals(issuedInvoices),
        unpaidInvoiceCount: outstandingInvoices.reduce(
          (sum, row) => sum + row.count,
          0,
        ),
        unpaidInvoiceTotals: totals(outstandingInvoices),
        overdueInvoiceCount: outstandingInvoices.reduce(
          (sum, row) => sum + row.overdue_count,
          0,
        ),
        overdueInvoiceTotals: outstandingInvoices
          .filter((row) => row.overdue_count > 0)
          .map((row) => ({
            currency: row.currency,
            amount: row.overdue_amount,
          })),
        incomeTotals: totals(income),
        expenseTotals: totals(expenses),
        cashflowTotals: totals(cashflow),
        unmatchedTransactionCount: unmatched[0]?.total_count ?? 0,
        unmatchedIncomingCount: unmatched[0]?.incoming_count ?? 0,
        unmatchedOutgoingCount: unmatched[0]?.outgoing_count ?? 0,
      };
    });
  }
}
