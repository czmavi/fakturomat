import type { Sql } from "@/database/d1.ts";
import { getDb } from "@/database/client.ts";
import type {
  OrganizationBillingInput,
  OrganizationRole,
  OrganizationSummary,
  OrganizationType,
} from "@/domain/organizations/types.ts";

interface OrganizationRow {
  id: string;
  type: OrganizationType;
  official_name: string;
  display_name: string;
  role: OrganizationRole;
}

export interface OrganizationRepository {
  listForUser(userId: string): Promise<OrganizationSummary[]>;
  findForUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationSummary | null>;
  createWithOwner(
    input: OrganizationBillingInput & {
      id: string;
      type: OrganizationType;
      officialName: string;
      displayName: string;
      ownerUserId: string;
    },
  ): Promise<OrganizationSummary>;
}

function toOrganization(row: OrganizationRow): OrganizationSummary {
  return {
    id: row.id,
    type: row.type,
    officialName: row.official_name,
    displayName: row.display_name,
    role: row.role,
  };
}

export class D1OrganizationRepository implements OrganizationRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const rows = await this.sql<OrganizationRow[]>`
      SELECT
        organizations.id,
        organizations.type,
        organizations.official_name,
        organizations.display_name,
        organization_memberships.role
      FROM organization_memberships
      JOIN organizations
        ON organizations.id = organization_memberships.organization_id
      WHERE organization_memberships.user_id = ${userId}
      ORDER BY lower(organizations.display_name), organizations.id
    `;
    return rows.map(toOrganization);
  }

  async findForUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationSummary | null> {
    const rows = await this.sql<OrganizationRow[]>`
      SELECT
        organizations.id,
        organizations.type,
        organizations.official_name,
        organizations.display_name,
        organization_memberships.role
      FROM organizations
      JOIN organization_memberships
        ON organization_memberships.organization_id = organizations.id
      WHERE organizations.id = ${organizationId}
        AND organization_memberships.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async createWithOwner(
    input: OrganizationBillingInput & {
      id: string;
      type: OrganizationType;
      officialName: string;
      displayName: string;
      ownerUserId: string;
    },
  ): Promise<OrganizationSummary> {
    await this.sql.begin((transaction) => {
      transaction.queue(transaction`
        INSERT INTO organizations (id, type, official_name, display_name, ico, dic, street, city, postal_code, country)
        VALUES (
          ${input.id},
          ${input.type},
          ${input.officialName},
          ${input.displayName},
          ${input.ico || null},
          ${input.dic || null},
          ${input.street || null},
          ${input.city || null},
          ${input.postalCode || null},
          ${input.country ?? "CZ"}
        )
      `);
      transaction.queue(transaction`
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES (${input.id}, ${input.ownerUserId}, 'OWNER')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'OWNER'
      `);
      transaction.queue(transaction`
        INSERT INTO invoice_number_sequences (
          id, organization_id, name, prefix, padding, is_default
        ) VALUES (${crypto.randomUUID()}, ${input.id}, 'Výchozí', '', 4, true)
      `);
      for (
        const name of [
          "Software",
          "Hardware",
          "Hosting",
          "Reklama",
          "Kancelář",
          "Cestovné",
          "Ostatní",
        ]
      ) {
        transaction.queue(
          transaction`INSERT INTO expense_categories (id, organization_id, name) VALUES (${crypto.randomUUID()}, ${input.id}, ${name})`,
        );
      }
    });

    return {
      id: input.id,
      type: input.type,
      officialName: input.officialName,
      displayName: input.displayName,
      role: "OWNER",
    };
  }
}
