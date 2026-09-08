import { define } from "@/utils.ts";
import { PostgresAuthRepository } from "@/repositories/auth_repository.ts";
import { SESSION_COOKIE_NAME } from "@/services/auth_service.ts";
import { createCookie } from "@/services/cookie_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Forbidden", { status: 403 });
    }

    if (ctx.state.sessionTokenHash !== null) {
      await new PostgresAuthRepository().revokeSession(
        ctx.state.sessionTokenHash,
      );
    }

    const response = ctx.redirect("/login", 303);
    response.headers.append(
      "Set-Cookie",
      createCookie(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        maxAge: 0,
        sameSite: "Lax",
      }),
    );
    return response;
  },
});
