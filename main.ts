import { recordRequestException } from "@/services/request_telemetry.ts";
import { App, csrf, staticFiles } from "fresh";
import { requestContextMiddleware } from "@/services/request_context_middleware.ts";
import type { State } from "./utils.ts";

export const app = new App<State>();

app.use(async (ctx) => {
  try {
    const response = await ctx.next();
    if (ctx.error != null) recordRequestException();
    return response;
  } catch (error) {
    recordRequestException();
    throw error;
  }
});
app.use(staticFiles());
app.use(csrf());
app.use(requestContextMiddleware);

// Include file-system based routes here
app.fsRoutes();
console.info("Application startup: configured");
