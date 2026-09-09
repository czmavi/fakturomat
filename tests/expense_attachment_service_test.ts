import type { ExpenseAttachment } from "@/domain/expenses/attachment.ts";
import type { ExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import {
  ExpenseAttachmentIntegrityError,
  ExpenseAttachmentService,
  ExpenseAttachmentValidationError,
  readVerifiedExpenseAttachment,
} from "@/services/expense_attachment_service.ts";
import type {
  ObjectStorage,
  StoredObject,
} from "@/services/storage/object_storage.ts";

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();

  put(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, data.slice());
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    const data = this.objects.get(key);
    return Promise.resolve(data ? { data: data.slice() } : null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

class FakeAttachmentRepository implements ExpenseAttachmentRepository {
  attachment: ExpenseAttachment | null = null;
  allowed = true;

  expenseExistsForUser(
    _organizationId: string,
    _expenseId: string,
    _userId: string,
  ): Promise<boolean> {
    return Promise.resolve(this.allowed);
  }

  listForExpenseForUser(
    _organizationId: string,
    _expenseId: string,
    _userId: string,
  ): Promise<ExpenseAttachment[]> {
    return Promise.resolve(this.attachment ? [this.attachment] : []);
  }

  findForUser(
    _organizationId: string,
    _expenseId: string,
    _attachmentId: string,
    _userId: string,
  ): Promise<ExpenseAttachment | null> {
    return Promise.resolve(this.attachment);
  }

  createForUser(
    input: Omit<ExpenseAttachment, "createdAt"> & { userId: string },
  ): Promise<ExpenseAttachment | null> {
    if (!this.allowed) return Promise.resolve(null);
    this.attachment = { ...input, createdAt: new Date() };
    return Promise.resolve(this.attachment);
  }

  deleteForUser(
    _organizationId: string,
    _expenseId: string,
    attachmentId: string,
    _userId: string,
  ): Promise<ExpenseAttachment | null> {
    if (!this.allowed || this.attachment?.id !== attachmentId) {
      return Promise.resolve(null);
    }
    const removed = this.attachment;
    this.attachment = null;
    return Promise.resolve(removed);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const scope = {
  organizationId: "30000000-0000-4000-8000-000000000001",
  expenseId: "30000000-0000-4000-8000-000000000002",
  userId: "30000000-0000-4000-8000-000000000003",
};

Deno.test("expense attachment validates, hashes and stores a PDF", async () => {
  const repository = new FakeAttachmentRepository();
  const storage = new MemoryStorage();
  const bytes = new TextEncoder().encode("%PDF-1.7\ntest attachment");
  const attachment = await new ExpenseAttachmentService(repository, storage)
    .upload({
      ...scope,
      file: new File([bytes], "../přijatá faktura.pdf", {
        type: "application/pdf",
      }),
    });

  assert(attachment !== null, "valid PDF was not stored");
  assert(attachment.filename === "přijatá faktura.pdf", "filename is unsafe");
  assert(
    !attachment.storageKey.includes("přijatá faktura"),
    "storage key was derived from the original filename",
  );
  assert(attachment.sha256.length === 64, "SHA-256 metadata is missing");
  const verified = await readVerifiedExpenseAttachment(storage, attachment);
  assert(verified.length === bytes.length, "verified bytes changed");
});

Deno.test("expense attachment rejects a spoofed MIME type", async () => {
  const repository = new FakeAttachmentRepository();
  const storage = new MemoryStorage();
  let rejected = false;
  try {
    await new ExpenseAttachmentService(repository, storage).upload({
      ...scope,
      file: new File(["%PDF-1.7\nnot a png"], "fake.png", {
        type: "image/png",
      }),
    });
  } catch (error) {
    rejected = error instanceof ExpenseAttachmentValidationError;
  }
  assert(rejected, "spoofed image was accepted");
  assert(storage.objects.size === 0, "rejected file reached storage");
});

Deno.test("expense attachment detects corruption and removes stored data", async () => {
  const repository = new FakeAttachmentRepository();
  const storage = new MemoryStorage();
  const service = new ExpenseAttachmentService(repository, storage);
  const attachment = await service.upload({
    ...scope,
    file: new File(["%PDF-1.7\noriginal"], "invoice.pdf", {
      type: "application/pdf",
    }),
  });
  assert(attachment !== null, "attachment setup failed");
  storage.objects.set(
    attachment.storageKey,
    new TextEncoder().encode("%PDF-1.7\nchanged!"),
  );
  let rejected = false;
  try {
    await readVerifiedExpenseAttachment(storage, attachment);
  } catch (error) {
    rejected = error instanceof ExpenseAttachmentIntegrityError;
  }
  assert(rejected, "corrupted attachment was accepted");
  assert(
    await service.remove({ ...scope, attachmentId: attachment.id }),
    "attachment metadata was not removed",
  );
  assert(storage.objects.size === 0, "removed attachment remained in storage");
});
