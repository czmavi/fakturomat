import type { R2Bucket } from "@/config/runtime.ts";
import {
  contentDisposition,
  type DocumentStorage,
  type DownloadInput,
  validateDocumentKey,
} from "./document_storage.ts";
import type { ObjectStorage } from "./object_storage.ts";

export class StorageObjectNotFound extends Error {}

export class R2DocumentStorage implements DocumentStorage {
  readonly provider = "r2";
  constructor(private readonly bucket: R2Bucket) {}
  async put(input: { key: string; data: Uint8Array; contentType: string }) {
    validateDocumentKey(input.key);
    const object = await this.bucket.put(input.key, input.data, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input.contentType },
    });
    if (!object) throw new Error("Invoice document already exists");
    return {
      storageProvider: "r2" as const,
      storageKey: input.key,
      etag: object.etag,
    };
  }
  async getDownloadTarget(input: DownloadInput) {
    validateDocumentKey(input.key);
    const object = await this.bucket.get(input.key);
    if (!object) throw new StorageObjectNotFound("Invoice document is missing");
    // The existing authenticated handler verifies SHA-256 before serving bytes.
    return {
      kind: "local" as const,
      data: new Uint8Array(await object.arrayBuffer()),
      contentDisposition: contentDisposition(input),
    };
  }
}
export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket) {}
  async put(key: string, data: Uint8Array): Promise<void> {
    validateDocumentKey(key);
    await this.bucket.put(key, data);
  }
  async get(key: string) {
    validateDocumentKey(key);
    const object = await this.bucket.get(key);
    return object ? { data: new Uint8Array(await object.arrayBuffer()) } : null;
  }
  async delete(key: string): Promise<void> {
    validateDocumentKey(key);
    await this.bucket.delete(key);
  }
}
