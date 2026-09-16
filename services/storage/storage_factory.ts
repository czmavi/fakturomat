import { LocalObjectStorage } from "@/services/storage/local_object_storage.ts";
import type { ObjectStorage } from "@/services/storage/object_storage.ts";
import { S3Client } from "@aws-sdk/client-s3";
import type { DocumentStorage, StorageProvider } from "./document_storage.ts";
import { LocalDocumentStorage } from "./local_document_storage.ts";
import {
  DocumentStorageConfigurationError,
  S3DocumentStorage,
} from "./s3_document_storage.ts";

let storage: ObjectStorage | undefined;
let documentStorage: Promise<DocumentStorage> | undefined;

export async function createDocumentStorage(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
  createS3Client: (region: string) => S3Client = (region) =>
    new S3Client({ region }),
): Promise<DocumentStorage> {
  const bucket = env("S3_BUCKET")?.trim();
  if (!bucket) {
    return new LocalDocumentStorage(
      env("LOCAL_STORAGE_PATH") || "./data/documents",
    );
  }
  const region = env("S3_REGION")?.trim() || env("AWS_REGION")?.trim();
  if (!region) {
    throw new DocumentStorageConfigurationError(
      "S3 document storage requires S3_REGION or AWS_REGION.",
    );
  }
  const client = createS3Client(region);
  const storage = new S3DocumentStorage(client, bucket);
  try {
    await storage.validateConfiguration();
    return storage;
  } catch (error) {
    client.destroy();
    throw error;
  }
}

export function getDocumentStorage(): Promise<DocumentStorage> {
  return documentStorage ??= createDocumentStorage().then((storage) => {
    console.log(`Document storage: ${storage.provider}`);
    return storage;
  });
}

export async function getDocumentStorageForProvider(
  provider: StorageProvider,
): Promise<DocumentStorage> {
  const storage = await getDocumentStorage();
  if (storage.provider === provider) return storage;
  // Explicit routing of historical local documents, never an S3 error fallback.
  if (provider === "local") {
    return new LocalDocumentStorage(
      Deno.env.get("LOCAL_STORAGE_PATH") || "./data/documents",
    );
  }
  throw new DocumentStorageConfigurationError(
    "S3 is required to read this invoice document.",
  );
}

export function getObjectStorage(): ObjectStorage {
  if (storage === undefined) {
    storage = new LocalObjectStorage(
      Deno.env.get("STORAGE_LOCAL_ROOT") ?? "./data/storage",
    );
  }
  return storage;
}
