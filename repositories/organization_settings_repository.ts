import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type { OrganizationSettings } from "@/domain/organizations/settings.ts";
import type { OrganizationType } from "@/domain/organizations/types.ts";

interface OrganizationSettingsRow {
  id: string;
  type: OrganizationType;
  official_name: string;
  display_name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logo_storage_key: string | null;
  logo_mime_type: string | null;
  default_currency: string;
  default_due_days: number;
  default_invoice_template_id: string;
  invoice_footer: string | null;
  custom_note: string | null;
}

export interface OrganizationSettingsRepository {
  findForUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationSettings | null>;
  updateForUser(
    input: OrganizationSettings & { userId: string },
  ): Promise<boolean>;
}

function fromRow(row: OrganizationSettingsRow): OrganizationSettings {
  return {
    id: row.id,
    type: row.type,
    officialName: row.official_name,
    displayName: row.display_name,
    ico: row.ico,
    dic: row.dic,
    street: row.street,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    email: row.email,
    phone: row.phone,
    website: row.website,
    logoStorageKey: row.logo_storage_key,
    logoMimeType: row.logo_mime_type,
    defaultCurrency: row.default_currency,
    defaultDueDays: row.default_due_days,
    defaultInvoiceTemplateId: row.default_invoice_template_id,
    invoiceFooter: row.invoice_footer,
    customNote: row.custom_note,
  };
}

const SETTINGS_COLUMNS = `
  organizations.id, organizations.type, organizations.official_name,
  organizations.display_name, organizations.ico, organizations.dic,
  organizations.street, organizations.city, organizations.postal_code,
  organizations.country, organizations.email, organizations.phone,
  organizations.website, organizations.logo_storage_key,
  organizations.logo_mime_type, organizations.default_currency,
  organizations.default_due_days, organizations.default_invoice_template_id,
  organizations.invoice_footer,
  organizations.custom_note
`;

export class PostgresOrganizationSettingsRepository
  implements OrganizationSettingsRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async findForUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationSettings | null> {
    const rows = await this.sql.unsafe<OrganizationSettingsRow[]>(
      `
      SELECT ${SETTINGS_COLUMNS}
      FROM organizations
      JOIN organization_memberships
        ON organization_memberships.organization_id = organizations.id
      WHERE organizations.id = $1
        AND organization_memberships.user_id = $2
      LIMIT 1
    `,
      [organizationId, userId],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async updateForUser(
    input: OrganizationSettings & { userId: string },
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE organizations
      SET
        type = ${input.type},
        official_name = ${input.officialName},
        display_name = ${input.displayName},
        ico = ${input.ico},
        dic = ${input.dic},
        street = ${input.street},
        city = ${input.city},
        postal_code = ${input.postalCode},
        country = ${input.country},
        email = ${input.email},
        phone = ${input.phone},
        website = ${input.website},
        logo_storage_key = ${input.logoStorageKey},
        logo_mime_type = ${input.logoMimeType},
        default_currency = ${input.defaultCurrency},
        default_due_days = ${input.defaultDueDays},
        default_invoice_template_id = ${input.defaultInvoiceTemplateId},
        invoice_footer = ${input.invoiceFooter},
        custom_note = ${input.customNote},
        updated_at = now()
      WHERE organizations.id = ${input.id}
        AND EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_memberships.organization_id = organizations.id
            AND organization_memberships.user_id = ${input.userId}
        )
      RETURNING id
    `;
    return rows.length === 1;
  }
}
