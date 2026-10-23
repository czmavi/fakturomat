import type { Sql } from "@/database/d1.ts";
import { getDb } from "@/database/client.ts";
import type {
  InvoiceDocument,
  PreparedInvoiceDocument,
} from "@/domain/invoices/invoice_document.ts";

interface InvoiceDocumentRow {
  id: string;
  organization_id: string;
  invoice_id: string;
  type: "PDF";
  storage_provider: "local" | "s3" | "r2";
  storage_key: string;
  etag: string | null;
  sha256: string;
  size: string;
  created_at: Date;
}

function documentFromRow(row: InvoiceDocumentRow): InvoiceDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    invoiceId: row.invoice_id,
    type: row.type,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    etag: row.etag,
    sha256: row.sha256,
    size: Number(row.size),
    createdAt: row.created_at,
  };
}

export interface InvoiceDocumentRepository {
  findPdfForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<InvoiceDocument | null>;
}

export class D1InvoiceDocumentRepository implements InvoiceDocumentRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async addRevisionForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
    document: PreparedInvoiceDocument,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO invoice_document_revisions
        (id, organization_id, invoice_id, type, storage_provider, storage_key, etag, sha256, size, created_by)
      SELECT ${document.id}, invoices.organization_id, invoices.id, 'PDF',
        ${document.storageProvider}, ${document.storageKey}, ${document.etag},
        ${document.sha256}, ${document.size}, ${userId}
      FROM invoices
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = invoices.organization_id
      WHERE invoices.id = ${invoiceId} AND invoices.organization_id = ${organizationId}
        AND memberships.user_id = ${userId} AND invoices.status <> 'DRAFT'
      RETURNING id
    `;
    return rows.length === 1;
  }

  async findPdfForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<InvoiceDocument | null> {
    const rows = await this.sql<InvoiceDocumentRow[]>`
      SELECT documents.id, documents.organization_id, documents.invoice_id,
        documents.type, documents.storage_provider, documents.storage_key, documents.etag, documents.sha256,
        documents.size, documents.created_at
      FROM (
        SELECT id, organization_id, invoice_id, type, storage_provider, storage_key,
          etag, sha256, size, created_at, 0 AS revision_order FROM invoice_documents
        UNION ALL
        SELECT id, organization_id, invoice_id, type, storage_provider, storage_key,
          etag, sha256, size, created_at, revision AS revision_order FROM invoice_document_revisions
      ) AS documents
      JOIN invoices
        ON invoices.id = documents.invoice_id
        AND invoices.organization_id = documents.organization_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = documents.organization_id
      WHERE documents.organization_id = ${organizationId}
        AND documents.invoice_id = ${invoiceId}
        AND documents.type = 'PDF'
        AND memberships.user_id = ${userId}
      ORDER BY documents.revision_order DESC
      LIMIT 1
    `;
    return rows[0] ? documentFromRow(rows[0]) : null;
  }
}
