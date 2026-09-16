import {
  contentDisposition,
  type DocumentStorage,
  type DownloadInput,
  type DownloadTarget,
  type StoredDocument,
} from "@/services/storage/document_storage.ts";

export class MemoryDocumentStorage implements DocumentStorage {
  readonly provider = "local";
  readonly objects = new Map<string, Uint8Array>();
  readonly uploads: Array<{ key: string; contentType: string }> = [];

  put(
    input: { key: string; data: Uint8Array; contentType: string },
  ): Promise<StoredDocument> {
    this.objects.set(input.key, input.data.slice());
    this.uploads.push(input);
    return Promise.resolve({
      storageProvider: this.provider,
      storageKey: input.key,
      etag: null,
    });
  }

  getDownloadTarget(input: DownloadInput): Promise<DownloadTarget> {
    const data = this.objects.get(input.key);
    if (!data) throw new Deno.errors.NotFound();
    return Promise.resolve({
      kind: "local",
      data: data.slice(),
      contentDisposition: contentDisposition(input),
    });
  }
}
