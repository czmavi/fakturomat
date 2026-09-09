import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type { InvoiceDocument } from "@/domain/invoices/invoice_document.ts";

interface InvoiceDocumentRow {
  id: string;
  organization_id: string;
  invoice_id: string;
  type: "PDF";
  storage_key: string;
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
    storageKey: row.storage_key,
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

export class PostgresInvoiceDocumentRepository
  implements InvoiceDocumentRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async findPdfForUser(
    organizationId: string,
    invoiceId: string,
    userId: string,
  ): Promise<InvoiceDocument | null> {
    const rows = await this.sql<InvoiceDocumentRow[]>`
      SELECT documents.id, documents.organization_id, documents.invoice_id,
        documents.type, documents.storage_key, documents.sha256,
        documents.size::text, documents.created_at
      FROM invoice_documents AS documents
      JOIN invoices
        ON invoices.id = documents.invoice_id
        AND invoices.organization_id = documents.organization_id
      JOIN organization_memberships AS memberships
        ON memberships.organization_id = documents.organization_id
      WHERE documents.organization_id = ${organizationId}
        AND documents.invoice_id = ${invoiceId}
        AND documents.type = 'PDF'
        AND memberships.user_id = ${userId}
      LIMIT 1
    `;
    return rows[0] ? documentFromRow(rows[0]) : null;
  }
}
