import { define } from "../utils.ts";

export const handler = define.handlers((ctx) => {
  return ctx.redirect(ctx.state.user === null ? "/login" : "/dashboard");
});
