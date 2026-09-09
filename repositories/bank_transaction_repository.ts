import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  BankProviderType,
  BankTransaction,
  BankTransactionDirection,
} from "@/domain/banking/types.ts";
import type { BankProviderTransaction } from "@/services/banking/bank_provider.ts";

interface BankTransactionRow {
  id: string;
  organization_id: string;
  bank_account_id: string;
  bank_account_name: string;
  provider: BankProviderType;
  provider_transaction_id: string;
  booking_date: string;
  amount: string;
  currency: string;
  counterparty_account: string | null;
  counterparty_bank_code: string | null;
  counterparty_name: string | null;
  variable_symbol: string | null;
  constant_symbol: string | null;
  specific_symbol: string | null;
  message: string | null;
  raw_data: unknown;
  created_at: Date;
}

function fromRow(row: BankTransactionRow): BankTransaction {
  return {
    id: row.id,
    organizationId: row.organization_id,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    provider: row.provider,
    providerTransactionId: row.provider_transaction_id,
    bookingDate: row.booking_date,
    amount: row.amount,
    currency: row.currency,
    counterpartyAccount: row.counterparty_account,
    counterpartyBankCode: row.counterparty_bank_code,
    counterpartyName: row.counterparty_name,
    variableSymbol: row.variable_symbol,
    constantSymbol: row.constant_symbol,
    specificSymbol: row.specific_symbol,
    message: row.message,
    rawData: row.raw_data,
    createdAt: row.created_at,
  };
}

export interface BankTransactionRepository {
  listForUser(input: {
    organizationId: string;
    userId: string;
    bankAccountId: string | null;
    direction: BankTransactionDirection;
    dateFrom: string | null;
    dateTo: string | null;
    limit?: number;
  }): Promise<BankTransaction[]>;
  importForUser(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: BankProviderType;
    transactions: BankProviderTransaction[];
    balance: { amount: string; currency: string; date: string } | null;
  }): Promise<{ inserted: number } | null>;
  markConnectionErrorForUser(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: BankProviderType;
  }): Promise<boolean>;
}

export class PostgresBankTransactionRepository
  implements BankTransactionRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(input: {
    organizationId: string;
    userId: string;
    bankAccountId: string | null;
    direction: BankTransactionDirection;
    dateFrom: string | null;
    dateTo: string | null;
    limit?: number;
  }): Promise<BankTransaction[]> {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const rows = await this.sql<BankTransactionRow[]>`
      SELECT bank_transactions.id, bank_transactions.organization_id,
        bank_transactions.bank_account_id,
        bank_accounts.name AS bank_account_name, bank_transactions.provider,
        bank_transactions.provider_transaction_id,
        bank_transactions.booking_date::text AS booking_date,
        bank_transactions.amount::text AS amount, bank_transactions.currency,
        bank_transactions.counterparty_account,
        bank_transactions.counterparty_bank_code,
        bank_transactions.counterparty_name,
        bank_transactions.variable_symbol,
        bank_transactions.constant_symbol,
        bank_transactions.specific_symbol, bank_transactions.message,
        bank_transactions.raw_data, bank_transactions.created_at
      FROM bank_transactions
      JOIN bank_accounts
        ON bank_accounts.id = bank_transactions.bank_account_id
        AND bank_accounts.organization_id = bank_transactions.organization_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = bank_transactions.organization_id
      WHERE bank_transactions.organization_id = ${input.organizationId}
        AND memberships.user_id = ${input.userId}
        AND (${input.bankAccountId}::uuid IS NULL
          OR bank_transactions.bank_account_id = ${input.bankAccountId})
        AND (
          ${input.direction} = 'ALL'
          OR (${input.direction} = 'INCOMING' AND bank_transactions.amount > 0)
          OR (${input.direction} = 'OUTGOING' AND bank_transactions.amount < 0)
        )
        AND (${input.dateFrom}::date IS NULL
          OR bank_transactions.booking_date >= ${input.dateFrom})
        AND (${input.dateTo}::date IS NULL
          OR bank_transactions.booking_date <= ${input.dateTo})
      ORDER BY bank_transactions.booking_date DESC,
        bank_transactions.created_at DESC, bank_transactions.id
      LIMIT ${limit}
    `;
    return rows.map(fromRow);
  }

  async importForUser(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: BankProviderType;
    transactions: BankProviderTransaction[];
    balance: { amount: string; currency: string; date: string } | null;
  }): Promise<{ inserted: number } | null> {
    return await this.sql.begin(async (transaction) => {
      const connections = await transaction<{ id: string }[]>`
        SELECT bank_connections.id
        FROM bank_connections
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = bank_connections.organization_id
        WHERE bank_connections.organization_id = ${input.organizationId}
          AND bank_connections.bank_account_id = ${input.bankAccountId}
          AND bank_connections.provider = ${input.provider}
          AND bank_connections.status <> 'DISABLED'
          AND memberships.user_id = ${input.userId}
        FOR UPDATE OF bank_connections
      `;
      if (!connections[0]) return null;

      let inserted = 0;
      for (const item of input.transactions) {
        const rows = await transaction<{ id: string }[]>`
          INSERT INTO bank_transactions (
            id, organization_id, bank_account_id, provider,
            provider_transaction_id, booking_date, amount, currency,
            counterparty_account, counterparty_bank_code, counterparty_name,
            variable_symbol, constant_symbol, specific_symbol, message,
            raw_data
          ) VALUES (
            ${crypto.randomUUID()}, ${input.organizationId},
            ${input.bankAccountId}, ${input.provider},
            ${item.providerTransactionId}, ${item.bookingDate}, ${item.amount},
            ${item.currency}, ${item.counterpartyAccount},
            ${item.counterpartyBankCode}, ${item.counterpartyName},
            ${item.variableSymbol}, ${item.constantSymbol},
            ${item.specificSymbol}, ${item.message},
            ${transaction.json(item.rawData)}
          )
          ON CONFLICT (provider, bank_account_id, provider_transaction_id)
            DO NOTHING
          RETURNING id
        `;
        inserted += rows.length;
      }

      await transaction`
        UPDATE bank_connections
        SET status = 'ACTIVE', last_sync_at = now(),
          current_balance = ${input.balance?.amount ?? null},
          balance_currency = ${input.balance?.currency ?? null},
          balance_date = ${input.balance?.date ?? null},
          updated_at = now()
        WHERE id = ${connections[0].id}
          AND organization_id = ${input.organizationId}
      `;
      return { inserted };
    });
  }

  async markConnectionErrorForUser(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: BankProviderType;
  }): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE bank_connections
      SET status = 'ERROR', updated_at = now()
      WHERE organization_id = ${input.organizationId}
        AND bank_account_id = ${input.bankAccountId}
        AND provider = ${input.provider}
        AND status <> 'DISABLED'
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        )
      RETURNING id
    `;
    return rows.length > 0;
  }
}
