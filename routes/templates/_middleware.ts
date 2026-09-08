import { define } from "@/utils.ts";

export default define.middleware((ctx) => {
  if (ctx.state.user === null) return ctx.redirect("/login");
  return ctx.next();
});
