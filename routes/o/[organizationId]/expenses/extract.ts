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
      const file = form.get("pdf");
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
      return respond({ ...result, proof });
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
