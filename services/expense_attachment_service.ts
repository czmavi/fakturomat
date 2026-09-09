import {
  type ExpenseAttachment,
  type ExpenseAttachmentMimeType,
  isExpenseAttachmentMimeType,
} from "@/domain/expenses/attachment.ts";
import type { ExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { sha256Hex } from "@/services/storage/integrity.ts";
import type { ObjectStorage } from "@/services/storage/object_storage.ts";

export const MAX_EXPENSE_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

export class ExpenseAttachmentValidationError extends Error {}
export class ExpenseAttachmentIntegrityError extends Error {}

function normalizeFilename(value: string): string {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const normalized = Array.from(leaf, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? "" : character;
  }).join("").trim();
  if (normalized.length === 0 || normalized.length > 255) {
    throw new ExpenseAttachmentValidationError(
      "Název přílohy musí mít 1 až 255 znaků.",
    );
  }
  return normalized;
}

function hasExpectedSignature(
  data: Uint8Array,
  mimeType: ExpenseAttachmentMimeType,
): boolean {
  if (mimeType === "application/pdf") {
    return data.length >= 5 && data[0] === 0x25 && data[1] === 0x50 &&
      data[2] === 0x44 && data[3] === 0x46 && data[4] === 0x2d;
  }
  if (mimeType === "image/png") {
    return data.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => data[i] === value);
  }
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 &&
    data[2] === 0xff;
}

function extensionFor(mimeType: ExpenseAttachmentMimeType): string {
  switch (mimeType) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
  }
}

export class ExpenseAttachmentService {
  constructor(
    private readonly repository: ExpenseAttachmentRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(input: {
    organizationId: string;
    expenseId: string;
    userId: string;
    file: File;
  }): Promise<ExpenseAttachment | null> {
    if (
      !await this.repository.expenseExistsForUser(
        input.organizationId,
        input.expenseId,
        input.userId,
      )
    ) {
      return null;
    }
    const filename = normalizeFilename(input.file.name);
    if (
      input.file.size <= 0 ||
      input.file.size > MAX_EXPENSE_ATTACHMENT_SIZE_BYTES
    ) {
      throw new ExpenseAttachmentValidationError(
        "Příloha musí mít nejvýše 20 MB a nesmí být prázdná.",
      );
    }
    if (!isExpenseAttachmentMimeType(input.file.type)) {
      throw new ExpenseAttachmentValidationError(
        "Příloha musí být PDF, JPG, JPEG nebo PNG.",
      );
    }
    const data = new Uint8Array(await input.file.arrayBuffer());
    if (
      data.length !== input.file.size ||
      !hasExpectedSignature(data, input.file.type)
    ) {
      throw new ExpenseAttachmentValidationError(
        "Obsah přílohy neodpovídá deklarovanému typu souboru.",
      );
    }
    const id = crypto.randomUUID();
    const storageKey =
      `organizations/${input.organizationId}/expenses/${input.expenseId}/${id}.${
        extensionFor(input.file.type)
      }`;
    const sha256 = await sha256Hex(data);
    await this.storage.put(storageKey, data);
    try {
      const attachment = await this.repository.createForUser({
        id,
        organizationId: input.organizationId,
        expenseId: input.expenseId,
        userId: input.userId,
        filename,
        mimeType: input.file.type,
        size: data.length,
        storageKey,
        sha256,
      });
      if (attachment === null) await this.storage.delete(storageKey);
      return attachment;
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async remove(input: {
    organizationId: string;
    expenseId: string;
    attachmentId: string;
    userId: string;
  }): Promise<boolean> {
    const attachment = await this.repository.deleteForUser(
      input.organizationId,
      input.expenseId,
      input.attachmentId,
      input.userId,
    );
    if (attachment === null) return false;
    try {
      await this.storage.delete(attachment.storageKey);
    } catch {
      console.warn(
        "Removed expense attachment could not be deleted from storage.",
      );
    }
    return true;
  }
}

export async function readVerifiedExpenseAttachment(
  storage: ObjectStorage,
  attachment: ExpenseAttachment,
): Promise<Uint8Array> {
  const object = await storage.get(attachment.storageKey);
  if (object === null) {
    throw new ExpenseAttachmentIntegrityError(
      "Příloha chybí v objektovém úložišti.",
    );
  }
  const sha256 = await sha256Hex(object.data);
  if (sha256 !== attachment.sha256 || object.data.length !== attachment.size) {
    throw new ExpenseAttachmentIntegrityError(
      "Kontrola integrity přílohy selhala.",
    );
  }
  return object.data;
}

export function attachmentContentDisposition(
  filename: string,
  disposition: "inline" | "attachment",
): string {
  const fallback = filename.replaceAll(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replaceAll(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
