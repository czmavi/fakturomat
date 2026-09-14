import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import { createPreviewInvoiceViewModel } from "@/services/invoice_template_preview.ts";
import { PdfLibRenderer } from "@/services/pdf/pdf_lib_renderer.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!isUuid(ctx.params.templateId) || !isUuid(ctx.params.versionId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const version = await new PostgresInvoiceTemplateRepository()
      .findVersionForUser(
        ctx.params.templateId,
        ctx.params.versionId,
        {
          organizationId: ctx.state.currentOrganization!.id,
          userId: ctx.state.user!.id,
        },
      );
    if (version === null) {
      return new Response("Verze nebyla nalezena.", { status: 404 });
    }
    const pdf = await new PdfLibRenderer().render(
      await createPreviewInvoiceViewModel(),
      version,
    );
    return new Response(pdf as Uint8Array<ArrayBuffer>, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=nahled-faktury.pdf",
        "Cache-Control": "no-store",
      },
    });
  },
});
