import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import {
  attachmentContentDisposition,
  ExpenseAttachmentIntegrityError,
  readVerifiedExpenseAttachment,
} from "@/services/expense_attachment_service.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (
      !isUuid(ctx.params.expenseId) || !isUuid(ctx.params.attachmentId)
    ) {
      return new Response("Příloha nebyla nalezena.", { status: 404 });
    }
    const attachment = await new PostgresExpenseAttachmentRepository()
      .findForUser(
        ctx.params.organizationId,
        ctx.params.expenseId,
        ctx.params.attachmentId,
        ctx.state.user!.id,
      );
    if (attachment === null) {
      return new Response("Příloha nebyla nalezena.", { status: 404 });
    }
    try {
      const data = await readVerifiedExpenseAttachment(
        getObjectStorage(),
        attachment,
      );
      const disposition = ctx.url.searchParams.get("download") === "1"
        ? "attachment"
        : "inline";
      return new Response(data.slice().buffer, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": attachmentContentDisposition(
            attachment.filename,
            disposition,
          ),
          "Content-Length": String(data.length),
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Type": attachment.mimeType,
          "ETag": `"sha256-${attachment.sha256}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof ExpenseAttachmentIntegrityError) {
        return new Response("Integritu přílohy nelze ověřit.", { status: 500 });
      }
      throw error;
    }
  },
});
