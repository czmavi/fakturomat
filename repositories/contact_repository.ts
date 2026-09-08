import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  Contact,
  ContactType,
  NormalizedContactInput,
} from "@/domain/contacts/types.ts";

interface ContactRow {
  id: string;
  organization_id: string;
  type: ContactType;
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  default_due_days: number | null;
  note: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContactRepository {
  listForUser(input: {
    organizationId: string;
    userId: string;
    search: string;
    includeArchived: boolean;
  }): Promise<Contact[]>;
  findForUser(
    organizationId: string,
    contactId: string,
    userId: string,
  ): Promise<Contact | null>;
  createForUser(
    input: NormalizedContactInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact | null>;
  updateForUser(
    input: NormalizedContactInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact | null>;
  archiveForUser(
    organizationId: string,
    contactId: string,
    userId: string,
  ): Promise<boolean>;
}

function fromRow(row: ContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    name: row.name,
    ico: row.ico,
    dic: row.dic,
    street: row.street,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    email: row.email,
    phone: row.phone,
    defaultDueDays: row.default_due_days,
    note: row.note,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RETURNING_COLUMNS = `
  id, organization_id, type, name, ico, dic, street, city, postal_code,
  country, email, phone, default_due_days, note, archived_at, created_at,
  updated_at
`;

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll(
    "_",
    "\\_",
  );
}

export class PostgresContactRepository implements ContactRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(input: {
    organizationId: string;
    userId: string;
    search: string;
    includeArchived: boolean;
  }): Promise<Contact[]> {
    const search = input.search.trim();
    const pattern = `%${escapeLike(search)}%`;
    const rows = await this.sql<ContactRow[]>`
      SELECT
        contacts.id, contacts.organization_id, contacts.type, contacts.name,
        contacts.ico, contacts.dic, contacts.street, contacts.city,
        contacts.postal_code, contacts.country, contacts.email, contacts.phone,
        contacts.default_due_days, contacts.note, contacts.archived_at,
        contacts.created_at, contacts.updated_at
      FROM contacts
      JOIN organization_memberships
        ON organization_memberships.organization_id = contacts.organization_id
      WHERE contacts.organization_id = ${input.organizationId}
        AND organization_memberships.user_id = ${input.userId}
        AND (${input.includeArchived} OR contacts.archived_at IS NULL)
        AND (
          ${search} = ''
          OR contacts.name ILIKE ${pattern} ESCAPE '\'
          OR COALESCE(contacts.ico, '') ILIKE ${pattern} ESCAPE '\'
          OR COALESCE(contacts.dic, '') ILIKE ${pattern} ESCAPE '\'
          OR COALESCE(contacts.email, '') ILIKE ${pattern} ESCAPE '\'
        )
      ORDER BY contacts.archived_at NULLS FIRST, lower(contacts.name), contacts.id
    `;
    return rows.map(fromRow);
  }

  async findForUser(
    organizationId: string,
    contactId: string,
    userId: string,
  ): Promise<Contact | null> {
    const rows = await this.sql<ContactRow[]>`
      SELECT
        contacts.id, contacts.organization_id, contacts.type, contacts.name,
        contacts.ico, contacts.dic, contacts.street, contacts.city,
        contacts.postal_code, contacts.country, contacts.email, contacts.phone,
        contacts.default_due_days, contacts.note, contacts.archived_at,
        contacts.created_at, contacts.updated_at
      FROM contacts
      JOIN organization_memberships
        ON organization_memberships.organization_id = contacts.organization_id
      WHERE contacts.id = ${contactId}
        AND contacts.organization_id = ${organizationId}
        AND organization_memberships.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async createForUser(
    input: NormalizedContactInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact | null> {
    const rows = await this.sql.unsafe<ContactRow[]>(
      `
      INSERT INTO contacts (
        id, organization_id, type, name, ico, dic, street, city, postal_code,
        country, email, phone, default_due_days, note
      )
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      FROM organization_memberships
      WHERE organization_id = $2 AND user_id = $15
      RETURNING ${RETURNING_COLUMNS}
    `,
      [
        input.id,
        input.organizationId,
        input.type,
        input.name,
        input.ico,
        input.dic,
        input.street,
        input.city,
        input.postalCode,
        input.country,
        input.email,
        input.phone,
        input.defaultDueDays,
        input.note,
        input.userId,
      ],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async updateForUser(
    input: NormalizedContactInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact | null> {
    const rows = await this.sql.unsafe<ContactRow[]>(
      `
      UPDATE contacts
      SET type = $1, name = $2, ico = $3, dic = $4, street = $5,
        city = $6, postal_code = $7, country = $8, email = $9, phone = $10,
        default_due_days = $11, note = $12, updated_at = now()
      WHERE id = $13 AND organization_id = $14
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = $14 AND user_id = $15
        )
      RETURNING ${RETURNING_COLUMNS}
    `,
      [
        input.type,
        input.name,
        input.ico,
        input.dic,
        input.street,
        input.city,
        input.postalCode,
        input.country,
        input.email,
        input.phone,
        input.defaultDueDays,
        input.note,
        input.id,
        input.organizationId,
        input.userId,
      ],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async archiveForUser(
    organizationId: string,
    contactId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE contacts
      SET archived_at = COALESCE(archived_at, now()), updated_at = now()
      WHERE id = ${contactId}
        AND organization_id = ${organizationId}
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${organizationId} AND user_id = ${userId}
        )
      RETURNING id
    `;
    return rows.length === 1;
  }
}
