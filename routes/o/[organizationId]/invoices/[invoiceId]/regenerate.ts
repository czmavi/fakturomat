import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { D1InvoiceRepository } from "@/repositories/invoice_repository.ts";
import { D1InvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import { D1InvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import { InvoiceDocumentService } from "@/services/invoice_document_service.ts";
import { PdfLibRenderer } from "@/services/pdf/pdf_lib_renderer.ts";
import { getDocumentStorage } from "@/services/storage/storage_factory.ts";

export const handler = define.handlers({
  GET() {
    return new Response("Metoda není povolena.", {
      status: 405,
      headers: { Allow: "POST" },
    });
  },
  async POST(ctx) {
    if (!ctx.state.user) {
      return new Response("Přihlášení je vyžadováno.", { status: 401 });
    }
    const { organizationId, invoiceId } = ctx.params;
    if (!isUuid(organizationId) || !isUuid(invoiceId)) {
      return new Response("Faktura nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Platnost formuláře vypršela.", { status: 403 });
    }
    if (form.get("confirmed") !== "yes") {
      return new Response("Potvrďte přegenerování PDF.", { status: 400 });
    }
    const userId = ctx.state.user.id;
    const invoice = await new D1InvoiceRepository().findForUser(
      organizationId,
      invoiceId,
      userId,
    );
    if (!invoice) {
      return new Response("Faktura nebyla nalezena.", { status: 404 });
    }
    if (invoice.status === "DRAFT" || !invoice.templateVersionId) {
      return new Response("Nejprve vystavte fakturu.", { status: 409 });
    }
    const detail = `/o/${organizationId}/invoices/${invoiceId}`;
    try {
      const template = await new D1InvoiceTemplateRepository()
        .findVersionForUser(
          invoice.invoiceTemplateId,
          invoice.templateVersionId,
          { organizationId, userId },
        );
      if (!template) return ctx.redirect(`${detail}?pdf_error=1`, 303);
      const document = await new InvoiceDocumentService(
        new PdfLibRenderer(),
        await getDocumentStorage(),
      ).prepare(invoice, template);
      const saved = await new D1InvoiceDocumentRepository().addRevisionForUser(
        organizationId,
        invoiceId,
        userId,
        document,
      );
      if (!saved) {
        return new Response("Faktura nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(`${detail}?pdf_regenerated=1`, 303);
    } catch (error) {
      console.error("Invoice PDF regeneration failed", error);
      return ctx.redirect(`${detail}?pdf_error=1`, 303);
    }
  },
});
