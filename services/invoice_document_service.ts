import type {
  InvoiceDocument,
  InvoiceDocumentPreparer,
  PreparedInvoiceDocument,
} from "@/domain/invoices/invoice_document.ts";
import type { Invoice } from "@/domain/invoices/types.ts";
import type { InvoiceTemplateVersion } from "@/domain/invoices/template_types.ts";
import { createInvoiceViewModel } from "@/services/invoice_view_model_service.ts";
import { renderInvoiceTemplate } from "@/services/invoice_template_renderer.ts";
import type { PdfRenderer } from "@/services/pdf/chromium_pdf_renderer.ts";
import type { ObjectStorage } from "@/services/storage/object_storage.ts";
import { sha256Hex } from "@/services/storage/integrity.ts";
export { sha256Hex } from "@/services/storage/integrity.ts";

const MAX_INVOICE_PDF_SIZE = 20 * 1024 * 1024;

export class InvoiceDocumentGenerationError extends Error {}
export class InvoiceDocumentIntegrityError extends Error {}

export class InvoiceDocumentService implements InvoiceDocumentPreparer {
  constructor(
    private readonly renderer: PdfRenderer,
    private readonly storage: ObjectStorage,
  ) {}

  async prepare(
    invoice: Invoice,
    templateVersion: InvoiceTemplateVersion,
  ): Promise<PreparedInvoiceDocument> {
    try {
      const viewModel = await createInvoiceViewModel(invoice);
      const html = renderInvoiceTemplate(
        templateVersion.html,
        templateVersion.css,
        viewModel,
      );
      const pdf = await this.renderer.render(html);
      if (pdf.length === 0 || pdf.length > MAX_INVOICE_PDF_SIZE) {
        throw new Error("PDF has an invalid size");
      }
      const id = crypto.randomUUID();
      const storageKey =
        `organizations/${invoice.organizationId}/invoices/${invoice.id}/${id}.pdf`;
      const sha256 = await sha256Hex(pdf);
      await this.storage.put(storageKey, pdf);
      return { id, type: "PDF", storageKey, sha256, size: pdf.length };
    } catch (error) {
      if (error instanceof InvoiceDocumentGenerationError) throw error;
      throw new InvoiceDocumentGenerationError(
        "PDF faktury se nepodařilo připravit.",
        { cause: error },
      );
    }
  }

  async discard(document: PreparedInvoiceDocument): Promise<void> {
    await this.storage.delete(document.storageKey);
  }
}

export async function readVerifiedInvoiceDocument(
  storage: ObjectStorage,
  document: InvoiceDocument,
): Promise<Uint8Array> {
  const object = await storage.get(document.storageKey);
  if (object === null) {
    throw new InvoiceDocumentIntegrityError(
      "Soubor PDF chybí v objektovém úložišti.",
    );
  }
  const sha256 = await sha256Hex(object.data);
  if (sha256 !== document.sha256 || object.data.length !== document.size) {
    throw new InvoiceDocumentIntegrityError(
      "Kontrola integrity PDF dokumentu selhala.",
    );
  }
  return object.data;
}
