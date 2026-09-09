import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import { ExpenseAttachmentService } from "@/services/expense_attachment_service.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

export const handler = define.handlers({
  async POST(ctx) {
    if (
      !isUuid(ctx.params.expenseId) || !isUuid(ctx.params.attachmentId)
    ) {
      return new Response("Příloha nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Platnost formuláře vypršela.", { status: 403 });
    }
    const removed = await new ExpenseAttachmentService(
      new PostgresExpenseAttachmentRepository(),
      getObjectStorage(),
    ).remove({
      organizationId: ctx.params.organizationId,
      expenseId: ctx.params.expenseId,
      attachmentId: ctx.params.attachmentId,
      userId: ctx.state.user!.id,
    });
    if (!removed) {
      return new Response("Příloha nebyla nalezena.", { status: 404 });
    }
    return ctx.redirect(
      `/o/${ctx.params.organizationId}/expenses/${ctx.params.expenseId}?attachment_removed=1`,
      303,
    );
  },
});
