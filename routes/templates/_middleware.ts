import { define } from "@/utils.ts";
import { PostgresOrganizationRepository } from "@/repositories/organization_repository.ts";

export default define.middleware(async (ctx) => {
  const user = ctx.state.user;
  if (user === null) return ctx.redirect("/login");

  const organizations = await new PostgresOrganizationRepository().listForUser(
    user.id,
  );
  const requestedId = ctx.url.searchParams.get("organizationId");
  const organization = organizations.find((item) => item.id === requestedId);
  if (!organization) {
    if (requestedId !== null || organizations.length === 0) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const url = new URL(ctx.url);
    url.searchParams.set("organizationId", organizations[0].id);
    return Response.redirect(url, 303);
  }

  ctx.state.currentOrganization = organization;
  ctx.state.organizations = organizations;
  return await ctx.next();
});
