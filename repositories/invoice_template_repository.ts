import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type {
  InvoiceTemplate,
  InvoiceTemplateVersion,
} from "@/domain/invoices/template_types.ts";

interface TemplateRow {
  id: string;
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

export interface InvoiceTemplateRepository {
  list(): Promise<InvoiceTemplate[]>;
  find(templateId: string): Promise<InvoiceTemplate | null>;
  findVersion(
    templateId: string,
    versionId: string,
  ): Promise<InvoiceTemplateVersion | null>;
  listVersions(templateId: string): Promise<InvoiceTemplateVersion[]>;
  create(input: {
    id: string;
    versionId: string;
    name: string;
    description: string | null;
    html: string;
    css: string;
    createdBy: string;
  }): Promise<InvoiceTemplate>;
  createVersion(input: {
    templateId: string;
    versionId: string;
    name: string;
    description: string | null;
    html: string;
    css: string;
    createdBy: string;
  }): Promise<InvoiceTemplateVersion | null>;
}

function templateFromRow(row: TemplateRow): InvoiceTemplate {
  return {
    id: row.id,
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

  async list(): Promise<InvoiceTemplate[]> {
    const rows = await this.sql<TemplateRow[]>`
      SELECT templates.id, templates.name, templates.description,
        templates.is_active, templates.current_version_id,
        versions.version AS current_version, templates.updated_at
      FROM invoice_templates AS templates
      JOIN invoice_template_versions AS versions
        ON versions.id = templates.current_version_id
        AND versions.invoice_template_id = templates.id
      ORDER BY templates.is_active DESC, lower(templates.name), templates.id
    `;
    return rows.map(templateFromRow);
  }

  async find(templateId: string): Promise<InvoiceTemplate | null> {
    const rows = await this.sql<TemplateRow[]>`
      SELECT templates.id, templates.name, templates.description,
        templates.is_active, templates.current_version_id,
        versions.version AS current_version, templates.updated_at
      FROM invoice_templates AS templates
      JOIN invoice_template_versions AS versions
        ON versions.id = templates.current_version_id
        AND versions.invoice_template_id = templates.id
      WHERE templates.id = ${templateId}
      LIMIT 1
    `;
    return rows[0] ? templateFromRow(rows[0]) : null;
  }

  async findVersion(
    templateId: string,
    versionId: string,
  ): Promise<InvoiceTemplateVersion | null> {
    const rows = await this.sql<VersionRow[]>`
      SELECT id, invoice_template_id, version, html, css, created_by, created_at
      FROM invoice_template_versions
      WHERE id = ${versionId} AND invoice_template_id = ${templateId}
      LIMIT 1
    `;
    return rows[0] ? versionFromRow(rows[0]) : null;
  }

  async listVersions(templateId: string): Promise<InvoiceTemplateVersion[]> {
    const rows = await this.sql<VersionRow[]>`
      SELECT id, invoice_template_id, version, html, css, created_by, created_at
      FROM invoice_template_versions
      WHERE invoice_template_id = ${templateId}
      ORDER BY version DESC
    `;
    return rows.map(versionFromRow);
  }

  async create(input: {
    id: string;
    versionId: string;
    name: string;
    description: string | null;
    html: string;
    css: string;
    createdBy: string;
  }): Promise<InvoiceTemplate> {
    return await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO invoice_templates (id, name, description)
        VALUES (${input.id}, ${input.name}, ${input.description})
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
      const rows = await transaction<TemplateRow[]>`
        SELECT templates.id, templates.name, templates.description,
          templates.is_active, templates.current_version_id,
          versions.version AS current_version, templates.updated_at
        FROM invoice_templates AS templates
        JOIN invoice_template_versions AS versions
          ON versions.id = templates.current_version_id
          AND versions.invoice_template_id = templates.id
        WHERE templates.id = ${input.id}
      `;
      return templateFromRow(rows[0]);
    });
  }

  async createVersion(input: {
    templateId: string;
    versionId: string;
    name: string;
    description: string | null;
    html: string;
    css: string;
    createdBy: string;
  }): Promise<InvoiceTemplateVersion | null> {
    return await this.sql.begin(async (transaction) => {
      const templates = await transaction<{ current_version_id: string }[]>`
        SELECT current_version_id
        FROM invoice_templates
        WHERE id = ${input.templateId}
        FOR UPDATE
      `;
      if (!templates[0]) return null;

      const currentVersions = await transaction<{ version: number }[]>`
        SELECT version
        FROM invoice_template_versions
        WHERE id = ${templates[0].current_version_id}
          AND invoice_template_id = ${input.templateId}
      `;
      if (!currentVersions[0]) {
        throw new Error("Current invoice template version is missing");
      }
      const version = currentVersions[0].version + 1;
      const rows = await transaction<VersionRow[]>`
        INSERT INTO invoice_template_versions (
          id, invoice_template_id, version, html, css, created_by
        ) VALUES (
          ${input.versionId}, ${input.templateId}, ${version}, ${input.html},
          ${input.css}, ${input.createdBy}
        )
        RETURNING id, invoice_template_id, version, html, css, created_by,
          created_at
      `;
      await transaction`
        UPDATE invoice_templates
        SET name = ${input.name}, description = ${input.description},
          current_version_id = ${input.versionId}, updated_at = now()
        WHERE id = ${input.templateId}
      `;
      return versionFromRow(rows[0]);
    });
  }
}
