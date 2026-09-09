import type { InvoiceDocument } from "@/domain/invoices/invoice_document.ts";
import {
  InvoiceDocumentIntegrityError,
  readVerifiedInvoiceDocument,
  sha256Hex,
} from "@/services/invoice_document_service.ts";
import type {
  ObjectStorage,
  StoredObject,
} from "@/services/storage/object_storage.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryStorage implements ObjectStorage {
  constructor(private data: Uint8Array | null) {}

  put(_key: string, data: Uint8Array): Promise<void> {
    this.data = data.slice();
    return Promise.resolve();
  }

  get(_key: string): Promise<StoredObject | null> {
    return Promise.resolve(this.data ? { data: this.data.slice() } : null);
  }

  delete(_key: string): Promise<void> {
    this.data = null;
    return Promise.resolve();
  }
}

async function metadata(data: Uint8Array): Promise<InvoiceDocument> {
  return {
    id: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
    invoiceId: crypto.randomUUID(),
    type: "PDF",
    storageKey: "invoices/test.pdf",
    sha256: await sha256Hex(data),
    size: data.length,
    createdAt: new Date(),
  };
}

Deno.test("invoice document verifies stored PDF hash and size", async () => {
  const data = new TextEncoder().encode("%PDF-1.7\nimmutable");
  const result = await readVerifiedInvoiceDocument(
    new MemoryStorage(data),
    await metadata(data),
  );
  assert(
    new TextDecoder().decode(result) === "%PDF-1.7\nimmutable",
    "verified document bytes changed",
  );
});

Deno.test("invoice document rejects corrupted storage content", async () => {
  const expected = new TextEncoder().encode("%PDF-1.7\nexpected");
  const corrupted = new TextEncoder().encode("%PDF-1.7\ncorrupted");
  let rejected = false;
  try {
    await readVerifiedInvoiceDocument(
      new MemoryStorage(corrupted),
      await metadata(expected),
    );
  } catch (error) {
    rejected = error instanceof InvoiceDocumentIntegrityError;
  }
  assert(rejected, "corrupted PDF was accepted");
});
