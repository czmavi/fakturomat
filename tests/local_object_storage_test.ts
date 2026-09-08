import { LocalObjectStorage } from "@/services/storage/local_object_storage.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("local object storage writes, reads and deletes an opaque key", async () => {
  const root = await Deno.makeTempDir({ prefix: "fakturomat-storage-test-" });
  const storage = new LocalObjectStorage(root);
  const key =
    `organizations/${crypto.randomUUID()}/logos/${crypto.randomUUID()}.png`;
  const expected = new Uint8Array([1, 2, 3, 4]);

  try {
    await storage.put(key, expected);
    const stored = await storage.get(key);
    assert(stored !== null, "stored object was not found");
    assert(stored.data.toHex() === expected.toHex(), "stored bytes changed");
    await storage.delete(key);
    assert(await storage.get(key) === null, "deleted object is still readable");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("local object storage rejects traversal keys", async () => {
  const root = await Deno.makeTempDir({ prefix: "fakturomat-storage-test-" });
  try {
    const storage = new LocalObjectStorage(root);
    let rejected = false;
    try {
      await storage.put("../outside", new Uint8Array([1]));
    } catch {
      rejected = true;
    }
    assert(rejected, "path traversal key was accepted");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
