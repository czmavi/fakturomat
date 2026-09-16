import { App, csrf, staticFiles } from "fresh";
import { requestContextMiddleware } from "@/services/request_context_middleware.ts";
import type { State } from "./utils.ts";

import { getDocumentStorage } from "@/services/storage/storage_factory.ts";
import { DocumentStorageConfigurationError } from "@/services/storage/s3_document_storage.ts";

console.info("Application startup: initializing document storage");
try {
  await getDocumentStorage();
} catch (error) {
  console.error(
    "Application startup failed:",
    error instanceof DocumentStorageConfigurationError
      ? error.message
      : "Document storage initialization failed",
  );
  throw error;
}

export const app = new App<State>();

app.use(staticFiles());
app.use(csrf());
app.use(requestContextMiddleware);

// Include file-system based routes here
app.fsRoutes();
console.info("Application startup: configured");
