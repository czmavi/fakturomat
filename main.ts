import { App, csrf, staticFiles } from "fresh";
import { loadAuthState } from "@/services/auth_service.ts";
import {
  createCsrfCookie,
  CSRF_COOKIE_NAME,
  getOrCreateCsrfToken,
} from "@/services/csrf_service.ts";
import { define, type State } from "./utils.ts";

export const app = new App<State>();

app.use(staticFiles());
app.use(csrf());

const securityMiddleware = define.middleware(async (ctx) => {
  const csrfState = getOrCreateCsrfToken(ctx.req);
  const authState = await loadAuthState(ctx.req);

  ctx.state.user = authState.user;
  ctx.state.sessionTokenHash = authState.sessionTokenHash;
  ctx.state.csrfToken = csrfState.token;
  ctx.state.organizations = [];
  ctx.state.currentOrganization = null;

  const response = await ctx.next();
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
    ].join("; "),
  );
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");

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
