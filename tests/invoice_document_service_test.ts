import type { InvoiceDocument } from "@/domain/invoices/invoice_document.ts";
import {
  InvoiceDocumentIntegrityError,
  readVerifiedInvoiceDocument,
  sha256Hex,
} from "@/services/invoice_document_service.ts";
import { MemoryDocumentStorage } from "@/tests/document_storage_test_helper.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function memoryStorage(data: Uint8Array): MemoryDocumentStorage {
  const storage = new MemoryDocumentStorage();
  storage.objects.set("invoices/test.pdf", data);
  return storage;
}

async function metadata(data: Uint8Array): Promise<InvoiceDocument> {
  return {
    id: crypto.randomUUID(),
    organizationId: crypto.randomUUID(),
    invoiceId: crypto.randomUUID(),
    type: "PDF",
    storageProvider: "local",
    storageKey: "invoices/test.pdf",
    etag: null,
    sha256: await sha256Hex(data),
    size: data.length,
    createdAt: new Date(),
  };
}

Deno.test("invoice document verifies stored PDF hash and size", async () => {
  const data = new TextEncoder().encode("%PDF-1.7\nimmutable");
  const result = await readVerifiedInvoiceDocument(
    memoryStorage(data),
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
      memoryStorage(corrupted),
      await metadata(expected),
    );
  } catch (error) {
    rejected = error instanceof InvoiceDocumentIntegrityError;
  }
  assert(rejected, "corrupted PDF was accepted");
});
