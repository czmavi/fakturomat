import { D1ExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";
import { sha256Hex } from "@/services/storage/integrity.ts";
import { D1ContactRepository } from "@/repositories/contact_repository.ts";
import { matchExpenseSupplier } from "@/services/expense_supplier_service.ts";
import { envValue } from "@/config/runtime.ts";
import { define } from "@/utils.ts";
import { D1OrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import {
  ExpensePdfError,
  ExpensePdfService,
  readInvoicePdf,
} from "@/services/expense_pdf_service.ts";
import { ExpenseValidationError } from "@/services/expense_service.ts";
import { createPdfProof } from "@/services/expense_pdf_proof.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    const respond = (data: unknown, status = 200) =>
      Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return respond(
        { error: "Platnost formuláře vypršela. Obnovte stránku." },
        403,
      );
    }
    const settings = await new D1OrganizationSettingsRepository()
      .findForUser(ctx.params.organizationId, ctx.state.user!.id);
    if (!settings) return respond({ error: "Firma není dostupná." }, 404);
    try {
      let file = form.get("pdf");
      const expenseId = String(form.get("expense_id") ?? "");
      if (expenseId) {
        const attachment = await new D1ExpenseAttachmentRepository()
          .findForUser(
            ctx.params.organizationId,
            expenseId,
            String(form.get("attachment_id") ?? ""),
            ctx.state.user!.id,
          );
        if (!attachment) {
          return respond({ error: "Příloha nákladu není dostupná." }, 404);
        }
        if (attachment.mimeType !== "application/pdf") {
          throw new ExpensePdfError(
            "Pro doplnění s AI vyberte uloženou PDF fakturu.",
          );
        }
        const object = await getObjectStorage().get(attachment.storageKey);
        if (!object || await sha256Hex(object.data) !== attachment.sha256) {
          throw new ExpensePdfError(
            "Původní soubor není dostupný nebo neprošel kontrolou integrity.",
          );
        }
        file = new File([object.data.slice().buffer], attachment.filename, {
          type: attachment.mimeType,
        });
      }
      if (!(file instanceof File)) {
        throw new ExpensePdfError("Vyberte PDF fakturu.");
      }
      const result = await new ExpensePdfService({
        apiKey: envValue("OPENAI_API_KEY") ?? "",
        model: envValue("OPENAI_EXPENSE_MODEL")?.trim() || "gpt-4.1-mini",
      }).extract(file, settings);
      const proof = await createPdfProof(
        await readInvoicePdf(file),
        settings.id,
        ctx.state.user!.id,
        result.recipient,
      );
      const contacts = await new D1ContactRepository().listForUser({
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
        search: "",
        includeArchived: false,
      });
      result.values.contactId =
        matchExpenseSupplier(result.supplier, contacts) ?? "";
      return respond({ ...result, proof, contacts });
    } catch (error) {
      if (
        error instanceof ExpensePdfError ||
        error instanceof ExpenseValidationError
      ) return respond({ error: error.message }, 422);
      console.error(
        "Expense PDF extraction failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      return respond({
        error:
          "Fakturu se nepodařilo načíst kvůli chybě serveru. Zkuste to znovu nebo soubor odeberte a vyplňte náklad ručně.",
      }, 500);
    }
  },
});
