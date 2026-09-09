import { App, csrf, staticFiles } from "fresh";
import { getAppEnvironment } from "@/config/env.ts";
import { loadAuthState } from "@/services/auth_service.ts";
import {
  createCsrfCookie,
  CSRF_COOKIE_NAME,
  getOrCreateCsrfToken,
} from "@/services/csrf_service.ts";
import {
  applySecurityHeaders,
  requestContentLengthIsTooLarge,
} from "@/services/security_headers.ts";
import { define, type State } from "./utils.ts";

export const app = new App<State>();

app.use(staticFiles());
app.use(csrf());

const securityMiddleware = define.middleware(async (ctx) => {
  if (requestContentLengthIsTooLarge(ctx.req)) {
    return applySecurityHeaders(
      new Response("Požadavek je příliš velký.", { status: 413 }),
      ctx.url,
      getAppEnvironment(),
    );
  }
  const csrfState = getOrCreateCsrfToken(ctx.req);
  const authState = await loadAuthState(ctx.req);

  ctx.state.user = authState.user;
  ctx.state.sessionTokenHash = authState.sessionTokenHash;
  ctx.state.csrfToken = csrfState.token;
  ctx.state.organizations = [];
  ctx.state.currentOrganization = null;

  const response = await ctx.next();
  applySecurityHeaders(response, ctx.url, getAppEnvironment());

  if (csrfState.created) {
    response.headers.append(
      "Set-Cookie",
      createCsrfCookie(CSRF_COOKIE_NAME, csrfState.token),
    );
  }

  return response;
});
app.use(securityMiddleware);

// Include file-system based routes here
app.fsRoutes();
