import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import { InvoiceService } from "@/services/invoice_service.ts";
import { InvoiceDocumentService } from "@/services/invoice_document_service.ts";
import { ChromiumPdfRenderer } from "@/services/pdf/chromium_pdf_renderer.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

export const handler = define.handlers({
  GET() {
    return new Response("Metoda není povolena.", {
      status: 405,
      headers: { Allow: "POST" },
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.invoiceId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Platnost formuláře vypršela.", { status: 403 });
    }
    const result = await new InvoiceService(
      new PostgresInvoiceRepository(),
      new InvoiceDocumentService(
        new ChromiumPdfRenderer(),
        getObjectStorage(),
      ),
    ).issue({
      id: ctx.params.invoiceId,
      organizationId: ctx.params.organizationId,
      userId: ctx.state.user!.id,
    });
    const detail =
      `/o/${ctx.params.organizationId}/invoices/${ctx.params.invoiceId}`;
    switch (result.kind) {
      case "issued":
        return ctx.redirect(`${detail}?issued=1`, 303);
      case "not_found":
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      case "not_draft":
        return ctx.redirect(`${detail}?issue_error=not_draft`, 303);
      case "bank_account_required":
        return ctx.redirect(`${detail}?issue_error=bank_account`, 303);
      case "bank_account_currency_mismatch":
        return ctx.redirect(`${detail}?issue_error=currency`, 303);
      case "qr_payment_unavailable":
        return ctx.redirect(`${detail}?issue_error=qr_payment`, 303);
      case "pdf_generation_failed":
        return ctx.redirect(`${detail}?issue_error=pdf`, 303);
      case "reference_unavailable":
        return ctx.redirect(`${detail}?issue_error=reference`, 303);
    }
  },
});
