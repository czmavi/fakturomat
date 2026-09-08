import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    if (!isUuid(ctx.params.contactId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Forbidden", { status: 403 });
    }
    const archived = await new PostgresContactRepository().archiveForUser(
      ctx.params.organizationId,
      ctx.params.contactId,
      ctx.state.user!.id,
    );
    if (!archived) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return ctx.redirect(`/o/${ctx.params.organizationId}/contacts`, 303);
  },
});
