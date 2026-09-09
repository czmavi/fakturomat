import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import {
  InvoiceDocumentIntegrityError,
  readVerifiedInvoiceDocument,
} from "@/services/invoice_document_service.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

function filename(number: string): string {
  const safeNumber = number.replaceAll(/[^A-Za-z0-9._-]/g, "-");
  return `faktura-${safeNumber}.pdf`;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!isUuid(ctx.params.invoiceId)) {
      return new Response("Dokument nebyl nalezen.", { status: 404 });
    }
    const userId = ctx.state.user!.id;
    const [invoice, document] = await Promise.all([
      new PostgresInvoiceRepository().findForUser(
        ctx.params.organizationId,
        ctx.params.invoiceId,
        userId,
      ),
      new PostgresInvoiceDocumentRepository().findPdfForUser(
        ctx.params.organizationId,
        ctx.params.invoiceId,
        userId,
      ),
    ]);
    if (invoice === null || document === null || invoice.number === null) {
      return new Response("Dokument nebyl nalezen.", { status: 404 });
    }
    try {
      const pdf = await readVerifiedInvoiceDocument(
        getObjectStorage(),
        document,
      );
      const disposition = ctx.url.searchParams.get("download") === "1"
        ? "attachment"
        : "inline";
      const documentFilename = filename(invoice.number);
      return new Response(pdf.slice().buffer, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition":
            `${disposition}; filename="${documentFilename}"`,
          "Content-Length": String(pdf.length),
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Type": "application/pdf",
          "ETag": `"sha256-${document.sha256}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof InvoiceDocumentIntegrityError) {
        return new Response("Integritu PDF dokumentu nelze ověřit.", {
          status: 500,
        });
      }
      throw error;
    }
  },
});
