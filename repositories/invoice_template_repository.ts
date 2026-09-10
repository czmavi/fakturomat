import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  InvoiceTemplate,
  InvoiceTemplateVersion,
} from "@/domain/invoices/template_types.ts";

interface TemplateRow {
  id: string;
  organization_id: string | null;
  source_template_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  current_version_id: string;
  current_version: number;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  invoice_template_id: string;
  version: number;
  html: string;
  css: string;
  created_by: string | null;
  created_at: Date;
}

interface TemplateScope {
  organizationId: string;
  userId: string;
}

export interface InvoiceTemplateRepository {
  listForUser(scope: TemplateScope): Promise<InvoiceTemplate[]>;
  findForUser(
    templateId: string,
    scope: TemplateScope,
  ): Promise<InvoiceTemplate | null>;
  findVersionForUser(
    templateId: string,
    versionId: string,
    scope: TemplateScope,
  ): Promise<InvoiceTemplateVersion | null>;
  listVersionsForUser(
    templateId: string,
    scope: TemplateScope,
  ): Promise<InvoiceTemplateVersion[]>;
  create(
    input: TemplateScope & {
      id: string;
      versionId: string;
      name: string;
      description: string | null;
      html: string;
      css: string;
      createdBy: string;
    },
  ): Promise<InvoiceTemplate | null>;
  createVersion(
    input: TemplateScope & {
      templateId: string;
      copyTemplateId: string;
      copyBaseVersionId: string;
      versionId: string;
      name: string;
      description: string | null;
      html: string;
      css: string;
      createdBy: string;
    },
  ): Promise<InvoiceTemplateVersion | null>;
}

const TEMPLATE_SELECT = `
  templates.id, templates.organization_id, templates.source_template_id,
  templates.name, templates.description, templates.is_active,
  templates.current_version_id, versions.version AS current_version,
  templates.updated_at
`;

function templateFromRow(row: TemplateRow): InvoiceTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    sourceTemplateId: row.source_template_id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    currentVersionId: row.current_version_id,
    currentVersion: row.current_version,
    updatedAt: row.updated_at,
  };
}

function versionFromRow(row: VersionRow): InvoiceTemplateVersion {
  return {
    id: row.id,
    invoiceTemplateId: row.invoice_template_id,
    version: row.version,
    html: row.html,
    css: row.css,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export class PostgresInvoiceTemplateRepository
  implements InvoiceTemplateRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async listForUser(scope: TemplateScope): Promise<InvoiceTemplate[]> {
    const rows = await this.sql.unsafe<TemplateRow[]>(
      `
      SELECT ${TEMPLATE_SELECT}
      FROM invoice_templates AS templates
      JOIN invoice_template_versions AS versions
        ON versions.id = templates.current_version_id
        AND versions.invoice_template_id = templates.id
      WHERE EXISTS (
        SELECT 1 FROM organization_memberships
        WHERE organization_id = $1 AND user_id = $2
      )
        AND (
          templates.organization_id = $1
          OR (
            templates.organization_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM invoice_templates AS copies
              WHERE copies.organization_id = $1
                AND copies.source_template_id = templates.id
            )
          )
        )
      ORDER BY templates.is_active DESC, lower(templates.name), templates.id
    `,
      [scope.organizationId, scope.userId],
    );
    return rows.map(templateFromRow);
  }

  async findForUser(
    templateId: string,
    scope: TemplateScope,
  ): Promise<InvoiceTemplate | null> {
    const rows = await this.sql.unsafe<TemplateRow[]>(
      `
      SELECT ${TEMPLATE_SELECT}
      FROM invoice_templates AS templates
      JOIN invoice_template_versions AS versions
        ON versions.id = templates.current_version_id
        AND versions.invoice_template_id = templates.id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = $2 AND memberships.user_id = $3
      WHERE templates.id = $1
        AND (templates.organization_id IS NULL OR templates.organization_id = $2)
      LIMIT 1
    `,
      [templateId, scope.organizationId, scope.userId],
    );
    return rows[0] ? templateFromRow(rows[0]) : null;
  }

  async findVersionForUser(
    templateId: string,
    versionId: string,
    scope: TemplateScope,
  ): Promise<InvoiceTemplateVersion | null> {
    const rows = await this.sql<VersionRow[]>`
      SELECT versions.id, versions.invoice_template_id, versions.version,
        versions.html, versions.css, versions.created_by, versions.created_at
      FROM invoice_template_versions AS versions
      JOIN invoice_templates AS templates
        ON templates.id = versions.invoice_template_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = ${scope.organizationId}
        AND memberships.user_id = ${scope.userId}
      WHERE versions.id = ${versionId}
        AND versions.invoice_template_id = ${templateId}
        AND (
          templates.organization_id IS NULL
          OR templates.organization_id = ${scope.organizationId}
        )
      LIMIT 1
    `;
    return rows[0] ? versionFromRow(rows[0]) : null;
  }

  async listVersionsForUser(
    templateId: string,
    scope: TemplateScope,
  ): Promise<InvoiceTemplateVersion[]> {
    const rows = await this.sql<VersionRow[]>`
      SELECT versions.id, versions.invoice_template_id, versions.version,
        versions.html, versions.css, versions.created_by, versions.created_at
      FROM invoice_template_versions AS versions
      JOIN invoice_templates AS templates
        ON templates.id = versions.invoice_template_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = ${scope.organizationId}
        AND memberships.user_id = ${scope.userId}
      WHERE versions.invoice_template_id = ${templateId}
        AND (
          templates.organization_id IS NULL
          OR templates.organization_id = ${scope.organizationId}
        )
      ORDER BY versions.version DESC
    `;
    return rows.map(versionFromRow);
  }

  async create(
    input: TemplateScope & {
      id: string;
      versionId: string;
      name: string;
      description: string | null;
      html: string;
      css: string;
      createdBy: string;
    },
  ): Promise<InvoiceTemplate | null> {
    return await this.sql.begin(async (transaction) => {
      const memberships = await transaction<{ allowed: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        ) AS allowed
      `;
      if (!memberships[0].allowed) return null;

      await transaction`
        INSERT INTO invoice_templates (
          id, organization_id, name, description
        ) VALUES (
          ${input.id}, ${input.organizationId}, ${input.name},
          ${input.description}
        )
      `;
      await transaction`
        INSERT INTO invoice_template_versions (
          id, invoice_template_id, version, html, css, created_by
        ) VALUES (
          ${input.versionId}, ${input.id}, 1, ${input.html}, ${input.css},
          ${input.createdBy}
        )
      `;
      await transaction`
        UPDATE invoice_templates
        SET current_version_id = ${input.versionId}, updated_at = now()
        WHERE id = ${input.id}
      `;
      const rows = await transaction.unsafe<TemplateRow[]>(
        `
        SELECT ${TEMPLATE_SELECT}
        FROM invoice_templates AS templates
        JOIN invoice_template_versions AS versions
          ON versions.id = templates.current_version_id
          AND versions.invoice_template_id = templates.id
        WHERE templates.id = $1
      `,
        [input.id],
      );
      return templateFromRow(rows[0]);
    });
  }

  async createVersion(
    input: TemplateScope & {
      templateId: string;
      copyTemplateId: string;
      copyBaseVersionId: string;
      versionId: string;
      name: string;
      description: string | null;
      html: string;
      css: string;
      createdBy: string;
    },
  ): Promise<InvoiceTemplateVersion | null> {
    return await this.sql.begin(async (transaction) => {
      const memberships = await transaction<{ allowed: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM organization_memberships
          WHERE organization_id = ${input.organizationId}
            AND user_id = ${input.userId}
        ) AS allowed
      `;
      if (!memberships[0].allowed) return null;

      const sources = await transaction<
        Array<{
          id: string;
          organization_id: string | null;
          name: string;
          description: string | null;
          current_version_id: string;
        }>
      >`
        SELECT id, organization_id, name, description, current_version_id
        FROM invoice_templates
        WHERE id = ${input.templateId}
          AND (
            organization_id IS NULL
            OR organization_id = ${input.organizationId}
          )
        FOR UPDATE
      `;
      const source = sources[0];
      if (!source) return null;

      let targetTemplateId = source.id;
      if (source.organization_id === null) {
        const existingCopies = await transaction<{ id: string }[]>`
          SELECT id
          FROM invoice_templates
          WHERE organization_id = ${input.organizationId}
            AND source_template_id = ${source.id}
          FOR UPDATE
        `;
        if (existingCopies[0]) {
          targetTemplateId = existingCopies[0].id;
        } else {
          const baseVersions = await transaction<VersionRow[]>`
            SELECT id, invoice_template_id, version, html, css, created_by,
              created_at
            FROM invoice_template_versions
            WHERE id = ${source.current_version_id}
              AND invoice_template_id = ${source.id}
          `;
          const base = baseVersions[0];
          if (!base) {
            throw new Error("Current invoice template version is missing");
          }

          targetTemplateId = input.copyTemplateId;
          await transaction`
            INSERT INTO invoice_templates (
              id, organization_id, source_template_id, name, description
            ) VALUES (
              ${targetTemplateId}, ${input.organizationId}, ${source.id},
              ${source.name}, ${source.description}
            )
          `;
          await transaction`
            INSERT INTO invoice_template_versions (
              id, invoice_template_id, version, html, css, created_by
            ) VALUES (
              ${input.copyBaseVersionId}, ${targetTemplateId}, 1,
              ${base.html}, ${base.css}, ${input.createdBy}
            )
          `;
          await transaction`
            UPDATE invoice_templates
            SET current_version_id = ${input.copyBaseVersionId},
              updated_at = now()
            WHERE id = ${targetTemplateId}
          `;
        }
        await transaction`
          UPDATE organizations
          SET default_invoice_template_id = ${targetTemplateId},
            updated_at = now()
          WHERE id = ${input.organizationId}
            AND default_invoice_template_id = ${source.id}
        `;
      }

      const targets = await transaction<{ current_version_id: string }[]>`
        SELECT current_version_id
        FROM invoice_templates
        WHERE id = ${targetTemplateId}
          AND organization_id = ${input.organizationId}
        FOR UPDATE
      `;
      if (!targets[0]) return null;
      const currentVersions = await transaction<{ version: number }[]>`
        SELECT version
        FROM invoice_template_versions
        WHERE id = ${targets[0].current_version_id}
          AND invoice_template_id = ${targetTemplateId}
      `;
      if (!currentVersions[0]) {
        throw new Error("Current invoice template version is missing");
      }
      const rows = await transaction<VersionRow[]>`
        INSERT INTO invoice_template_versions (
          id, invoice_template_id, version, html, css, created_by
        ) VALUES (
          ${input.versionId}, ${targetTemplateId},
          ${currentVersions[0].version + 1}, ${input.html}, ${input.css},
          ${input.createdBy}
        )
        RETURNING id, invoice_template_id, version, html, css, created_by,
          created_at
      `;
      await transaction`
        UPDATE invoice_templates
        SET name = ${input.name}, description = ${input.description},
          current_version_id = ${input.versionId}, updated_at = now()
        WHERE id = ${targetTemplateId}
          AND organization_id = ${input.organizationId}
      `;
      return versionFromRow(rows[0]);
    });
  }
}
