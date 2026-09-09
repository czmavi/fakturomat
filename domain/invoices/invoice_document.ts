import type { Invoice } from "@/domain/invoices/types.ts";
import type { InvoiceTemplateVersion } from "@/domain/invoices/template_types.ts";

export type InvoiceDocumentType = "PDF";

export interface InvoiceDocument {
  id: string;
  organizationId: string;
  invoiceId: string;
  type: InvoiceDocumentType;
  storageKey: string;
  sha256: string;
  size: number;
  createdAt: Date;
}

export interface PreparedInvoiceDocument {
  id: string;
  type: InvoiceDocumentType;
  storageKey: string;
  sha256: string;
  size: number;
}

export interface InvoiceDocumentPreparer {
  prepare(
    invoice: Invoice,
    templateVersion: InvoiceTemplateVersion,
  ): Promise<PreparedInvoiceDocument>;
  discard(document: PreparedInvoiceDocument): Promise<void>;
}
