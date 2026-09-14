import { define } from "@/utils.ts";
import { getAuth } from "@/services/better_auth.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Forbidden", { status: 403 });
    }

    const authResponse = await getAuth().api.signOut({
      headers: ctx.req.headers,
      asResponse: true,
    });
    const response = ctx.redirect("/login", 303);
    for (const cookie of authResponse.headers.getSetCookie()) {
      response.headers.append("Set-Cookie", cookie);
    }
    return response;
  },
});
