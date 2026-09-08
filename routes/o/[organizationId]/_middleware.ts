import { define } from "@/utils.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresOrganizationRepository } from "@/repositories/organization_repository.ts";

export default define.middleware(async (ctx) => {
  const user = ctx.state.user;
  if (user === null) return ctx.redirect("/login");

  const organizationId = ctx.params.organizationId;
  if (!isUuid(organizationId)) {
    return new Response("Stránka nebyla nalezena.", { status: 404 });
  }

  const repository = new PostgresOrganizationRepository();
  const [organization, organizations] = await Promise.all([
    repository.findForUser(organizationId, user.id),
    repository.listForUser(user.id),
  ]);

  if (organization === null) {
    return new Response("Stránka nebyla nalezena.", { status: 404 });
  }

  ctx.state.currentOrganization = organization;
  ctx.state.organizations = organizations;
  return await ctx.next();
});
