import type { InvoiceRepository } from "@/repositories/invoice_repository.ts";
import type { InvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";
import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import {
  getInvoiceDocumentDownloadTarget,
  InvoiceDocumentIntegrityError,
} from "@/services/invoice_document_service.ts";
import { getDocumentStorageForProvider } from "@/services/storage/storage_factory.ts";

function filename(number: string): string {
  const safeNumber = number.replaceAll(/[^A-Za-z0-9._-]/g, "-");
  return `faktura-${safeNumber}.pdf`;
}

export function createInvoicePdfHandler(dependencies: {
  invoices: Pick<InvoiceRepository, "findForUser">;
  documents: InvoiceDocumentRepository;
  storage: typeof getDocumentStorageForProvider;
} = {
  invoices: {
    findForUser: (...args) =>
      new PostgresInvoiceRepository().findForUser(...args),
  },
  documents: {
    findPdfForUser: (...args) =>
      new PostgresInvoiceDocumentRepository().findPdfForUser(...args),
  },
  storage: getDocumentStorageForProvider,
}) {
  return define.handlers({
    async GET(ctx) {
      if (!ctx.state.user) {
        return new Response("Přihlášení je vyžadováno.", { status: 401 });
      }
      if (!isUuid(ctx.params.organizationId) || !isUuid(ctx.params.invoiceId)) {
        return new Response("Dokument nebyl nalezen.", { status: 404 });
      }
      const userId = ctx.state.user!.id;
      const [invoice, document] = await Promise.all([
        dependencies.invoices.findForUser(
          ctx.params.organizationId,
          ctx.params.invoiceId,
          userId,
        ),
        dependencies.documents.findPdfForUser(
          ctx.params.organizationId,
          ctx.params.invoiceId,
          userId,
        ),
      ]);
      if (invoice === null || document === null || invoice.number === null) {
        return new Response("Dokument nebyl nalezen.", { status: 404 });
      }
      try {
        const disposition = ctx.url.searchParams.get("download") === "1"
          ? "attachment"
          : "inline";
        const documentFilename = filename(invoice.number);
        const target = await getInvoiceDocumentDownloadTarget(
          await dependencies.storage(document.storageProvider),
          document,
          documentFilename,
          disposition,
        );
        if (target.kind === "redirect") {
          return new Response(null, {
            status: 302,
            headers: {
              Location: target.url,
              "Cache-Control": "private, no-store",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        const pdf = target.data;
        return new Response(pdf.slice().buffer, {
          headers: {
            "Cache-Control": "private, no-store",
            "Content-Disposition": target.contentDisposition,
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
}

export const handler = createInvoicePdfHandler();
