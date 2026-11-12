import server from "fresh:server_entry";
import { withRuntime } from "./config/runtime.ts";
import { traceHttp } from "./services/request_telemetry.ts";
export default {
  fetch(request, env, ctx) {
    return traceHttp(
      request,
      env.CONTROL_TELEMETRY_API_KEY,
      ctx,
      () => withRuntime(env, () => server.fetch(request, env, ctx)),
    );
  },
};
