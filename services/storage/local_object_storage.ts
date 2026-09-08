import { dirname, resolve, SEPARATOR } from "@std/path";
import type {
  ObjectStorage,
  StoredObject,
} from "@/services/storage/object_storage.ts";

export class LocalObjectStorage implements ObjectStorage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(key)) {
      throw new Error("Invalid object storage key");
    }
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + SEPARATOR)) {
      throw new Error("Object storage key escapes storage root");
    }
    return path;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await Deno.mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.tmp-${crypto.randomUUID()}`;
    try {
      await Deno.writeFile(temporaryPath, data, { createNew: true });
      await Deno.rename(temporaryPath, path);
    } catch (error) {
      try {
        await Deno.remove(temporaryPath);
      } catch (cleanupError) {
        if (!(cleanupError instanceof Deno.errors.NotFound)) throw cleanupError;
      }
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      return { data: await Deno.readFile(this.pathFor(key)) };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await Deno.remove(this.pathFor(key));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}
