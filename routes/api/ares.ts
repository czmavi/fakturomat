import { define } from "@/utils.ts";
import { AresError, lookupAres } from "@/services/ares_service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return Response.json({
        error: "Přihlášení vypršelo. Přihlaste se znovu.",
      }, { status: 401 });
    }
    try {
      return Response.json(
        await lookupAres(ctx.url.searchParams.get("ico") ?? ""),
        {
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    } catch (error) {
      if (error instanceof AresError) {
        return Response.json({ error: error.message }, {
          status: error.status,
        });
      }
      throw error;
    }
  },
});
