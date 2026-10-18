import { runtime } from "@/config/runtime.ts";
import type { DocumentStorage, StorageProvider } from "./document_storage.ts";
import type { ObjectStorage } from "./object_storage.ts";
import { R2DocumentStorage, R2ObjectStorage } from "./r2_storage.ts";

export function getDocumentStorage(): Promise<DocumentStorage> {
  return Promise.resolve(new R2DocumentStorage(runtime().DOCUMENTS));
}
export function getDocumentStorageForProvider(
  provider: StorageProvider,
): Promise<DocumentStorage> {
  if (provider !== "r2") {
    throw new Error("Document has not been migrated to R2");
  }
  return getDocumentStorage();
}
export function getObjectStorage(): ObjectStorage {
  return new R2ObjectStorage(runtime().FILES);
}
