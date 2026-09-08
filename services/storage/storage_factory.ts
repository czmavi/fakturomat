import { LocalObjectStorage } from "@/services/storage/local_object_storage.ts";
import type { ObjectStorage } from "@/services/storage/object_storage.ts";

let storage: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  if (storage === undefined) {
    storage = new LocalObjectStorage(
      Deno.env.get("STORAGE_LOCAL_ROOT") ?? "./data/storage",
    );
  }
  return storage;
}
