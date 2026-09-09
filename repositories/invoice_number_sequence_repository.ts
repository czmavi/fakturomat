import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/database/client.ts";
import {
  formatInvoiceNumber,
  type InvoiceNumberSequence,
  type NormalizedInvoiceNumberSequenceInput,
} from "@/domain/invoices/number_sequence_types.ts";

interface SequenceRow {
  id: string;
  organization_id: string;
  name: string;
  prefix: string;
  padding: number;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceNumberSequenceRepository {
  listForUser(
    organizationId: string,
    userId: string,
  ): Promise<InvoiceNumberSequence[]>;
  findForUser(
    organizationId: string,
    sequenceId: string,
    userId: string,
  ): Promise<InvoiceNumberSequence | null>;
  createForUser(
    input: NormalizedInvoiceNumberSequenceInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null>;
  updateForUser(
    input: NormalizedInvoiceNumberSequenceInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null>;
  allocateNextForUser(input: {
    organizationId: string;
    sequenceId: string;
    userId: string;
    year: number;
  }): Promise<string | null>;
}

const SELECT_COLUMNS = `
  sequences.id, sequences.organization_id, sequences.name, sequences.prefix,
  sequences.padding, sequences.is_default, sequences.is_active,
  sequences.created_at, sequences.updated_at
`;

const RETURNING_COLUMNS = `
  id, organization_id, name, prefix, padding, is_default, is_active,
  created_at, updated_at
`;

function fromRow(row: SequenceRow): InvoiceNumberSequence {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    prefix: row.prefix,
    padding: row.padding,
    isDefault: row.is_default,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function allocateNextInvoiceNumber(
  sql: TransactionSql,
  sequence: InvoiceNumberSequence,
  year: number,
): Promise<string> {
  const counters = await sql<{ last_value: string }[]>`
    INSERT INTO invoice_number_counters (
      invoice_number_sequence_id, year, last_value
    ) VALUES (${sequence.id}, ${year}, 1)
    ON CONFLICT (invoice_number_sequence_id, year)
    DO UPDATE SET last_value = invoice_number_counters.last_value + 1,
      updated_at = now()
    RETURNING last_value::text
  `;
  return formatInvoiceNumber(sequence, year, BigInt(counters[0].last_value));
}

export class PostgresInvoiceNumberSequenceRepository
  implements InvoiceNumberSequenceRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(
    organizationId: string,
    userId: string,
  ): Promise<InvoiceNumberSequence[]> {
    const rows = await this.sql<SequenceRow[]>`
      SELECT ${this.sql.unsafe(SELECT_COLUMNS)}
      FROM invoice_number_sequences AS sequences
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = sequences.organization_id
      WHERE sequences.organization_id = ${organizationId}
        AND memberships.user_id = ${userId}
      ORDER BY sequences.is_default DESC, sequences.is_active DESC,
        lower(sequences.name), sequences.id
    `;
    return rows.map(fromRow);
  }

  async findForUser(
    organizationId: string,
    sequenceId: string,
    userId: string,
  ): Promise<InvoiceNumberSequence | null> {
    const rows = await this.sql<SequenceRow[]>`
      SELECT ${this.sql.unsafe(SELECT_COLUMNS)}
      FROM invoice_number_sequences AS sequences
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = sequences.organization_id
      WHERE sequences.id = ${sequenceId}
        AND sequences.organization_id = ${organizationId}
        AND memberships.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async createForUser(
    input: NormalizedInvoiceNumberSequenceInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null> {
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

      const count = await transaction<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM invoice_number_sequences
        WHERE organization_id = ${input.organizationId} AND is_active
      `;
      const isDefault = input.isDefault ||
        (input.isActive && count[0].count === 0);
      if (isDefault) {
        await transaction`
          UPDATE invoice_number_sequences
          SET is_default = false, updated_at = now()
          WHERE organization_id = ${input.organizationId} AND is_default
        `;
      }

      const rows = await transaction.unsafe<SequenceRow[]>(
        `
        INSERT INTO invoice_number_sequences (
          id, organization_id, name, prefix, padding, is_default, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING ${RETURNING_COLUMNS}
      `,
        [
          input.id,
          input.organizationId,
          input.name,
          input.prefix,
          input.padding,
          isDefault,
          input.isActive,
        ],
      );
      return fromRow(rows[0]);
    });
  }

  async updateForUser(
    input: NormalizedInvoiceNumberSequenceInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null> {
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

      const current = await transaction<SequenceRow[]>`
        SELECT ${transaction.unsafe(SELECT_COLUMNS)}
        FROM invoice_number_sequences AS sequences
        WHERE sequences.id = ${input.id}
          AND sequences.organization_id = ${input.organizationId}
        FOR UPDATE OF sequences
      `;
      if (!current[0]) return null;

      if (input.isDefault) {
        await transaction`
          UPDATE invoice_number_sequences
          SET is_default = false, updated_at = now()
          WHERE organization_id = ${input.organizationId}
            AND id <> ${input.id} AND is_default
        `;
      }

      await transaction.unsafe<SequenceRow[]>(
        `
        UPDATE invoice_number_sequences
        SET name = $1, prefix = $2, padding = $3, is_default = $4,
          is_active = $5, updated_at = now()
        WHERE id = $6 AND organization_id = $7
        RETURNING ${RETURNING_COLUMNS}
      `,
        [
          input.name,
          input.prefix,
          input.padding,
          input.isDefault,
          input.isActive,
          input.id,
          input.organizationId,
        ],
      );

      if (current[0].is_default && !input.isDefault) {
        const promoted = await transaction<{ id: string }[]>`
          UPDATE invoice_number_sequences
          SET is_default = true, updated_at = now()
          WHERE id = (
            SELECT id FROM invoice_number_sequences
            WHERE organization_id = ${input.organizationId}
              AND id <> ${input.id} AND is_active
            ORDER BY created_at, id LIMIT 1
          )
          RETURNING id
        `;
        if (!promoted[0] && input.isActive) {
          await transaction`
            UPDATE invoice_number_sequences
            SET is_default = true, updated_at = now()
            WHERE id = ${input.id} AND organization_id = ${input.organizationId}
          `;
        }
      }

      const finalRows = await transaction<SequenceRow[]>`
        SELECT ${transaction.unsafe(SELECT_COLUMNS)}
        FROM invoice_number_sequences AS sequences
        WHERE sequences.id = ${input.id}
          AND sequences.organization_id = ${input.organizationId}
      `;
      return fromRow(finalRows[0]);
    });
  }

  async allocateNextForUser(input: {
    organizationId: string;
    sequenceId: string;
    userId: string;
    year: number;
  }): Promise<string | null> {
    return await this.sql.begin(async (transaction) => {
      const rows = await transaction<SequenceRow[]>`
        SELECT ${transaction.unsafe(SELECT_COLUMNS)}
        FROM invoice_number_sequences AS sequences
        JOIN organization_memberships AS memberships
          ON memberships.organization_id = sequences.organization_id
        WHERE sequences.id = ${input.sequenceId}
          AND sequences.organization_id = ${input.organizationId}
          AND memberships.user_id = ${input.userId}
          AND sequences.is_active
        LIMIT 1
      `;
      if (!rows[0]) return null;

      return await allocateNextInvoiceNumber(
        transaction,
        fromRow(rows[0]),
        input.year,
      );
    });
  }
}
