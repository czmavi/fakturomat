import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import {
  ExpenseAttachmentService,
  ExpenseAttachmentValidationError,
} from "@/services/expense_attachment_service.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

export const handler = define.handlers({
  async POST(ctx) {
    if (!isUuid(ctx.params.expenseId)) {
      return new Response("Náklad nebyl nalezen.", { status: 404 });
    }
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Platnost formuláře vypršela.", { status: 403 });
    }
    const file = form.get("attachment");
    if (!(file instanceof File)) {
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/expenses/${ctx.params.expenseId}?attachment_error=invalid`,
        303,
      );
    }
    try {
      const attachment = await new ExpenseAttachmentService(
        new PostgresExpenseAttachmentRepository(),
        getObjectStorage(),
      ).upload({
        organizationId: ctx.params.organizationId,
        expenseId: ctx.params.expenseId,
        userId: ctx.state.user!.id,
        file,
      });
      if (attachment === null) {
        return new Response("Náklad nebyl nalezen.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/expenses/${ctx.params.expenseId}?attachment_uploaded=1`,
        303,
      );
    } catch (error) {
      if (error instanceof ExpenseAttachmentValidationError) {
        return ctx.redirect(
          `/o/${ctx.params.organizationId}/expenses/${ctx.params.expenseId}?attachment_error=invalid`,
          303,
        );
      }
      throw error;
    }
  },
});
