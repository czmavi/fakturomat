import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  BankAccount,
  NormalizedBankAccountInput,
} from "@/domain/banking/types.ts";

interface BankAccountRow {
  id: string;
  organization_id: string;
  name: string;
  bank_name: string | null;
  account_prefix: string | null;
  account_number: string | null;
  bank_code: string | null;
  iban: string | null;
  bic: string | null;
  currency: string;
  is_default: boolean;
  is_active: boolean;
}

export interface BankAccountRepository {
  listForUser(organizationId: string, userId: string): Promise<BankAccount[]>;
  findForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<BankAccount | null>;
  createForUser(
    input: NormalizedBankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount | null>;
  updateForUser(
    input: NormalizedBankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount | null>;
}

function fromRow(row: BankAccountRow): BankAccount {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    bankName: row.bank_name,
    accountPrefix: row.account_prefix,
    accountNumber: row.account_number,
    bankCode: row.bank_code,
    iban: row.iban,
    bic: row.bic,
    currency: row.currency,
    isDefault: row.is_default,
    isActive: row.is_active,
  };
}

const RETURNING_COLUMNS = `
  id, organization_id, name, bank_name, account_prefix, account_number,
  bank_code, iban, bic, currency, is_default, is_active
`;

export class PostgresBankAccountRepository implements BankAccountRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(
    organizationId: string,
    userId: string,
  ): Promise<BankAccount[]> {
    const rows = await this.sql<BankAccountRow[]>`
      SELECT
        bank_accounts.id, bank_accounts.organization_id, bank_accounts.name,
        bank_accounts.bank_name, bank_accounts.account_prefix,
        bank_accounts.account_number, bank_accounts.bank_code,
        bank_accounts.iban, bank_accounts.bic, bank_accounts.currency,
        bank_accounts.is_default, bank_accounts.is_active
      FROM bank_accounts
      JOIN organization_memberships
        ON organization_memberships.organization_id = bank_accounts.organization_id
      WHERE bank_accounts.organization_id = ${organizationId}
        AND organization_memberships.user_id = ${userId}
      ORDER BY bank_accounts.is_default DESC, bank_accounts.is_active DESC,
        bank_accounts.created_at, bank_accounts.id
    `;
    return rows.map(fromRow);
  }

  async findForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<BankAccount | null> {
    const rows = await this.sql<BankAccountRow[]>`
      SELECT
        bank_accounts.id, bank_accounts.organization_id, bank_accounts.name,
        bank_accounts.bank_name, bank_accounts.account_prefix,
        bank_accounts.account_number, bank_accounts.bank_code,
        bank_accounts.iban, bank_accounts.bic, bank_accounts.currency,
        bank_accounts.is_default, bank_accounts.is_active
      FROM bank_accounts
      JOIN organization_memberships
        ON organization_memberships.organization_id = bank_accounts.organization_id
      WHERE bank_accounts.id = ${bankAccountId}
        AND bank_accounts.organization_id = ${organizationId}
        AND organization_memberships.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async createForUser(
    input: NormalizedBankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount | null> {
    return await this.sql.begin(async (transaction) => {
      const access = await transaction<{ id: string }[]>`
        SELECT organizations.id
        FROM organizations
        JOIN organization_memberships
          ON organization_memberships.organization_id = organizations.id
        WHERE organizations.id = ${input.organizationId}
          AND organization_memberships.user_id = ${input.userId}
        FOR UPDATE OF organizations
      `;
      if (!access[0]) return null;

      const activeAccounts = await transaction<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM bank_accounts
        WHERE organization_id = ${input.organizationId} AND is_active
      `;
      const isDefault = input.isDefault ||
        (input.isActive && activeAccounts[0].count === 0);
      if (isDefault) {
        await transaction`
          UPDATE bank_accounts SET is_default = false, updated_at = now()
          WHERE organization_id = ${input.organizationId} AND is_default
        `;
      }

      const rows = await transaction.unsafe<BankAccountRow[]>(
        `
        INSERT INTO bank_accounts (
          id, organization_id, name, bank_name, account_prefix, account_number,
          bank_code, iban, bic, currency, is_default, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING ${RETURNING_COLUMNS}
      `,
        [
          input.id,
          input.organizationId,
          input.name,
          input.bankName,
          input.accountPrefix,
          input.accountNumber,
          input.bankCode,
          input.iban,
          input.bic,
          input.currency,
          isDefault,
          input.isActive,
        ],
      );
      return fromRow(rows[0]);
    });
  }

  async updateForUser(
    input: NormalizedBankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount | null> {
    return await this.sql.begin(async (transaction) => {
      const access = await transaction<{ id: string }[]>`
        SELECT organizations.id
        FROM organizations
        JOIN organization_memberships
          ON organization_memberships.organization_id = organizations.id
        WHERE organizations.id = ${input.organizationId}
          AND organization_memberships.user_id = ${input.userId}
        FOR UPDATE OF organizations
      `;
      if (!access[0]) return null;

      const current = await transaction<{ is_default: boolean }[]>`
        SELECT is_default FROM bank_accounts
        WHERE id = ${input.id} AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      if (!current[0]) return null;

      if (input.isDefault) {
        await transaction`
          UPDATE bank_accounts SET is_default = false, updated_at = now()
          WHERE organization_id = ${input.organizationId}
            AND id <> ${input.id}
            AND is_default
        `;
      }

      const rows = await transaction.unsafe<BankAccountRow[]>(
        `
        UPDATE bank_accounts
        SET name = $1, bank_name = $2, account_prefix = $3,
          account_number = $4, bank_code = $5, iban = $6, bic = $7,
          currency = $8, is_default = $9, is_active = $10, updated_at = now()
        WHERE id = $11 AND organization_id = $12
        RETURNING ${RETURNING_COLUMNS}
      `,
        [
          input.name,
          input.bankName,
          input.accountPrefix,
          input.accountNumber,
          input.bankCode,
          input.iban,
          input.bic,
          input.currency,
          input.isDefault,
          input.isActive,
          input.id,
          input.organizationId,
        ],
      );
      if (!rows[0]) return null;

      if (current[0].is_default && !input.isDefault) {
        const promoted = await transaction<{ id: string }[]>`
          UPDATE bank_accounts
          SET is_default = true, updated_at = now()
          WHERE id = (
            SELECT id FROM bank_accounts
            WHERE organization_id = ${input.organizationId}
              AND id <> ${input.id}
              AND is_active
            ORDER BY created_at, id
            LIMIT 1
          )
          RETURNING id
        `;
        if (!promoted[0] && input.isActive) {
          await transaction`
            UPDATE bank_accounts SET is_default = true, updated_at = now()
            WHERE id = ${input.id} AND organization_id = ${input.organizationId}
          `;
        }
      }

      const finalRows = await transaction<BankAccountRow[]>`
        SELECT id, organization_id, name, bank_name, account_prefix,
          account_number, bank_code, iban, bic, currency, is_default, is_active
        FROM bank_accounts
        WHERE id = ${input.id} AND organization_id = ${input.organizationId}
      `;
      return fromRow(finalRows[0]);
    });
  }
}
