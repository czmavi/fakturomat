export const EXPENSE_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type ExpenseAttachmentMimeType =
  typeof EXPENSE_ATTACHMENT_MIME_TYPES[number];

export interface ExpenseAttachment {
  id: string;
  organizationId: string;
  expenseId: string;
  filename: string;
  mimeType: ExpenseAttachmentMimeType;
  size: number;
  storageKey: string;
  sha256: string;
  createdAt: Date;
}

export function isExpenseAttachmentMimeType(
  value: string,
): value is ExpenseAttachmentMimeType {
  return (EXPENSE_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}
