import { getAuth } from "@/services/better_auth.ts";
import { define } from "@/utils.ts";

export const handler = define.handlers({
  GET(ctx) {
    return getAuth().handler(ctx.req);
  },
  POST(ctx) {
    return getAuth().handler(ctx.req);
  },
});
