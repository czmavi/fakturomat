import { App, csrf, staticFiles } from "fresh";
import { requestContextMiddleware } from "@/services/request_context_middleware.ts";
import type { State } from "./utils.ts";

import { getDocumentStorage } from "@/services/storage/storage_factory.ts";

await getDocumentStorage();

export const app = new App<State>();

app.use(staticFiles());
app.use(csrf());
app.use(requestContextMiddleware);

// Include file-system based routes here
app.fsRoutes();
