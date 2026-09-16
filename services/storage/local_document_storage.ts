import { dirname, resolve } from "@std/path";
import {
  contentDisposition,
  type DocumentStorage,
  type DownloadInput,
  type DownloadTarget,
  type StoredDocument,
  validateDocumentKey,
} from "./document_storage.ts";

export class LocalDocumentStorage implements DocumentStorage {
  readonly provider = "local";
  readonly root: string;

  constructor(root = "./data/documents") {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    validateDocumentKey(key);
    return resolve(this.root, key);
  }

  async put(input: {
    key: string;
    data: Uint8Array;
    contentType: string;
  }): Promise<StoredDocument> {
    const path = this.pathFor(input.key);
    await Deno.mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`;
    try {
      await Deno.writeFile(temporaryPath, input.data, { createNew: true });
      // Publish atomically without replacing an existing immutable document.
      await Deno.link(temporaryPath, path);
    } finally {
      await Deno.remove(temporaryPath).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
    return {
      storageProvider: this.provider,
      storageKey: input.key,
      etag: null,
    };
  }

  async getDownloadTarget(input: DownloadInput): Promise<DownloadTarget> {
    return {
      kind: "local",
      data: await Deno.readFile(this.pathFor(input.key)),
      contentDisposition: contentDisposition(input),
    };
  }
}
