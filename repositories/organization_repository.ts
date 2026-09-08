import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
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
  createWithOwner(input: {
    id: string;
    type: OrganizationType;
    officialName: string;
    displayName: string;
    ownerUserId: string;
  }): Promise<OrganizationSummary>;
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

export class PostgresOrganizationRepository implements OrganizationRepository {
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

  async createWithOwner(input: {
    id: string;
    type: OrganizationType;
    officialName: string;
    displayName: string;
    ownerUserId: string;
  }): Promise<OrganizationSummary> {
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO organizations (id, type, official_name, display_name)
        VALUES (
          ${input.id},
          ${input.type},
          ${input.officialName},
          ${input.displayName}
        )
      `;
      await transaction`
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES (${input.id}, ${input.ownerUserId}, 'OWNER')
      `;
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
