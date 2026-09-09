import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import { createPreviewInvoiceViewModel } from "@/services/invoice_template_preview.ts";
import { renderInvoiceTemplate } from "@/services/invoice_template_renderer.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!isUuid(ctx.params.templateId) || !isUuid(ctx.params.versionId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const version = await new PostgresInvoiceTemplateRepository().findVersion(
      ctx.params.templateId,
      ctx.params.versionId,
    );
    if (version === null) {
      return new Response("Verze nebyla nalezena.", { status: 404 });
    }
    return new Response(
      renderInvoiceTemplate(
        version.html,
        version.css,
        await createPreviewInvoiceViewModel(),
      ),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  },
});
