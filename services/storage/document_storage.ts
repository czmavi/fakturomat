export type StorageProvider = "local" | "s3";

export interface StoredDocument {
  storageProvider: StorageProvider;
  storageKey: string;
  etag: string | null;
}

export interface DownloadInput {
  key: string;
  filename: string;
  disposition?: "inline" | "attachment";
}

export type DownloadTarget =
  | { kind: "redirect"; url: string }
  | { kind: "local"; data: Uint8Array; contentDisposition: string };

export interface DocumentStorage {
  readonly provider: StorageProvider;
  put(input: {
    key: string;
    data: Uint8Array;
    contentType: string;
  }): Promise<StoredDocument>;
  getDownloadTarget(input: DownloadInput): Promise<DownloadTarget>;
}

export function contentDisposition(input: DownloadInput): string {
  const filename = input.filename.replaceAll(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 180) || "faktura.pdf";
  const disposition = input.disposition === "attachment"
    ? "attachment"
    : "inline";
  return `${disposition}; filename="${filename}"`;
}

export function validateDocumentKey(key: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid document storage key");
  }
}
