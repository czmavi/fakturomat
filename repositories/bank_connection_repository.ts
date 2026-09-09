import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  BankConnection,
  BankConnectionStatus,
  BankConnectionWithCredentials,
  BankProviderType,
} from "@/domain/banking/types.ts";

interface ConnectionRow {
  id: string;
  organization_id: string;
  bank_account_id: string;
  provider: BankProviderType;
  status: BankConnectionStatus;
  last_sync_at: Date | null;
  current_balance: string | null;
  balance_currency: string | null;
  balance_date: string | null;
  created_at: Date;
  updated_at: Date;
}

interface CredentialRow extends ConnectionRow {
  encrypted_credentials: string;
}

function fromRow(row: ConnectionRow): BankConnection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    bankAccountId: row.bank_account_id,
    provider: row.provider,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    currentBalance: row.current_balance,
    balanceCurrency: row.balance_currency,
    balanceDate: row.balance_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function withCredentialsFromRow(
  row: CredentialRow,
): BankConnectionWithCredentials {
  return { ...fromRow(row), encryptedCredentials: row.encrypted_credentials };
}

export interface BankConnectionRepository {
  bankAccountExistsForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<boolean>;
  findForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<BankConnection | null>;
  findWithCredentialsForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<BankConnectionWithCredentials | null>;
  upsertForUser(input: {
    id: string;
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: BankProviderType;
    encryptedCredentials: string;
    status: BankConnectionStatus;
  }): Promise<BankConnection | null>;
  deleteForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<boolean>;
}

const SAFE_COLUMNS = `
  id, organization_id, bank_account_id, provider, status, last_sync_at,
  current_balance::text AS current_balance, balance_currency,
  balance_date::text AS balance_date, created_at, updated_at
`;

const SCOPED_JOINS = `
  JOIN bank_accounts
    ON bank_accounts.id = bank_connections.bank_account_id
    AND bank_accounts.organization_id = bank_connections.organization_id
  JOIN organization_memberships AS memberships
    ON memberships.organization_id = bank_connections.organization_id
`;

export class PostgresBankConnectionRepository
  implements BankConnectionRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async bankAccountExistsForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM bank_accounts
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = bank_accounts.organization_id
        WHERE bank_accounts.id = ${bankAccountId}
          AND bank_accounts.organization_id = ${organizationId}
          AND memberships.user_id = ${userId}
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  }

  async findForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<BankConnection | null> {
    const rows = await this.sql.unsafe<ConnectionRow[]>(
      `
      SELECT bank_connections.id, bank_connections.organization_id,
        bank_connections.bank_account_id, bank_connections.provider,
        bank_connections.status, bank_connections.last_sync_at,
        bank_connections.current_balance::text AS current_balance,
        bank_connections.balance_currency,
        bank_connections.balance_date::text AS balance_date,
        bank_connections.created_at, bank_connections.updated_at
      FROM bank_connections
      ${SCOPED_JOINS}
      WHERE bank_connections.organization_id = $1
        AND bank_connections.bank_account_id = $2
        AND memberships.user_id = $3
      LIMIT 1
    `,
      [organizationId, bankAccountId, userId],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findWithCredentialsForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<BankConnectionWithCredentials | null> {
    const rows = await this.sql.unsafe<CredentialRow[]>(
      `
      SELECT bank_connections.id, bank_connections.organization_id,
        bank_connections.bank_account_id, bank_connections.provider,
        bank_connections.status, bank_connections.last_sync_at,
        bank_connections.current_balance::text AS current_balance,
        bank_connections.balance_currency,
        bank_connections.balance_date::text AS balance_date,
        bank_connections.created_at, bank_connections.updated_at,
        bank_connections.encrypted_credentials
      FROM bank_connections
      ${SCOPED_JOINS}
      WHERE bank_connections.organization_id = $1
        AND bank_connections.bank_account_id = $2
        AND memberships.user_id = $3
      LIMIT 1
    `,
      [organizationId, bankAccountId, userId],
    );
    return rows[0] ? withCredentialsFromRow(rows[0]) : null;
  }

  async upsertForUser(input: {
    id: string;
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: BankProviderType;
    encryptedCredentials: string;
    status: BankConnectionStatus;
  }): Promise<BankConnection | null> {
    const rows = await this.sql.unsafe<ConnectionRow[]>(
      `
      INSERT INTO bank_connections (
        id, organization_id, bank_account_id, provider,
        encrypted_credentials, status
      )
      SELECT $1, $2, $3, $4, $5, $6
      FROM bank_accounts
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = bank_accounts.organization_id
      WHERE bank_accounts.id = $3
        AND bank_accounts.organization_id = $2
        AND memberships.user_id = $7
      ON CONFLICT (bank_account_id, provider) DO UPDATE
      SET encrypted_credentials = EXCLUDED.encrypted_credentials,
        status = EXCLUDED.status, updated_at = now()
      RETURNING ${SAFE_COLUMNS}
    `,
      [
        input.id,
        input.organizationId,
        input.bankAccountId,
        input.provider,
        input.encryptedCredentials,
        input.status,
        input.userId,
      ],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async deleteForUser(
    organizationId: string,
    bankAccountId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      DELETE FROM bank_connections
      WHERE organization_id = ${organizationId}
        AND bank_account_id = ${bankAccountId}
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${organizationId} AND user_id = ${userId}
        )
      RETURNING id
    `;
    return rows.length > 0;
  }
}
