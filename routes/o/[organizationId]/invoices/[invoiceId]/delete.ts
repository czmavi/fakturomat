import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import { InvoiceDeletionService } from "@/services/invoice_deletion_service.ts";

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
      return new Response("Potvrďte smazání faktury.", { status: 400 });
    }
    const root = `/o/${organizationId}/invoices`;
    try {
      const result = await new InvoiceDeletionService().deleteForUser({
        organizationId,
        invoiceId,
        userId: ctx.state.user.id,
      });
      if (result === "not_found") {
        return new Response("Faktura nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        result === "deleted"
          ? `${root}?deleted=1`
          : `${root}?cleanup=${invoiceId}`,
        303,
      );
    } catch (error) {
      console.error("Invoice deletion failed", error);
      return ctx.redirect(`${root}/${invoiceId}?delete_error=1`, 303);
    }
  },
});
