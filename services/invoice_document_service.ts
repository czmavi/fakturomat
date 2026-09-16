import type {
  InvoiceDocument,
  InvoiceDocumentPreparer,
  PreparedInvoiceDocument,
} from "@/domain/invoices/invoice_document.ts";
import type { Invoice } from "@/domain/invoices/types.ts";
import type { InvoiceTemplateVersion } from "@/domain/invoices/template_types.ts";
import { createInvoiceViewModel } from "@/services/invoice_view_model_service.ts";
import type { PdfRenderer } from "@/services/pdf/pdf_lib_renderer.ts";
import type {
  DocumentStorage,
  DownloadTarget,
} from "@/services/storage/document_storage.ts";
import { sha256Hex } from "@/services/storage/integrity.ts";
export { sha256Hex } from "@/services/storage/integrity.ts";

const MAX_INVOICE_PDF_SIZE = 20 * 1024 * 1024;

export class InvoiceDocumentGenerationError extends Error {}
export class InvoiceDocumentIntegrityError extends Error {}

export class InvoiceDocumentService implements InvoiceDocumentPreparer {
  constructor(
    private readonly renderer: PdfRenderer,
    private readonly storage: DocumentStorage,
  ) {}

  async prepare(
    invoice: Invoice,
    templateVersion: InvoiceTemplateVersion,
  ): Promise<PreparedInvoiceDocument> {
    try {
      const viewModel = await createInvoiceViewModel(invoice);
      const pdf = await this.renderer.render(viewModel, templateVersion);
      if (pdf.length === 0 || pdf.length > MAX_INVOICE_PDF_SIZE) {
        throw new Error("PDF has an invalid size");
      }
      const sha256 = await sha256Hex(pdf);
      const id = crypto.randomUUID();
      const storageKey =
        `invoices/${invoice.organizationId}/${invoice.id}/${id}.pdf`;
      const stored = await this.storage.put({
        key: storageKey,
        data: pdf,
        contentType: "application/pdf",
      });
      return { id, type: "PDF", ...stored, sha256, size: pdf.length };
    } catch (error) {
      if (error instanceof InvoiceDocumentGenerationError) throw error;
      throw new InvoiceDocumentGenerationError(
        "PDF faktury se nepodařilo připravit.",
        { cause: error },
      );
    }
  }
}

export async function getInvoiceDocumentDownloadTarget(
  storage: DocumentStorage,
  document: InvoiceDocument,
  filename: string,
  disposition: "inline" | "attachment" = "inline",
): Promise<DownloadTarget> {
  if (storage.provider !== document.storageProvider) {
    throw new InvoiceDocumentIntegrityError(
      "Document storage provider mismatch",
    );
  }
  let target: DownloadTarget;
  try {
    target = await storage.getDownloadTarget({
      key: document.storageKey,
      filename,
      disposition,
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new InvoiceDocumentIntegrityError(
        "Soubor PDF chybí v objektovém úložišti.",
      );
    }
    throw error;
  }
  if (target.kind === "local") {
    const sha256 = await sha256Hex(target.data);
    if (sha256 !== document.sha256 || target.data.length !== document.size) {
      throw new InvoiceDocumentIntegrityError(
        "Kontrola integrity PDF dokumentu selhala.",
      );
    }
  }
  return target;
}

export async function readVerifiedInvoiceDocument(
  storage: DocumentStorage,
  document: InvoiceDocument,
): Promise<Uint8Array> {
  const target = await getInvoiceDocumentDownloadTarget(
    storage,
    document,
    "faktura.pdf",
  );
  if (target.kind !== "local") {
    throw new Error("Document requires a signed download");
  }
  return target.data;
}
