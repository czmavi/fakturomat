import { define } from "@/utils.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user!;
    const settings = await new PostgresOrganizationSettingsRepository()
      .findForUser(
        ctx.params.organizationId,
        user.id,
      );
    if (!settings?.logoStorageKey || !settings.logoMimeType) {
      return new Response("Soubor nebyl nalezen.", { status: 404 });
    }
    const object = await getObjectStorage().get(settings.logoStorageKey);
    if (object === null) {
      return new Response("Soubor nebyl nalezen.", { status: 404 });
    }
    return new Response(object.data.slice().buffer, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": settings.logoMimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
});
