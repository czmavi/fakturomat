import server from "fresh:server_entry";
import { withRuntime } from "./config/runtime.ts";
export default {
  fetch(request, env, ctx) {
    return withRuntime(env, () => server.fetch(request, env, ctx));
  },
};
