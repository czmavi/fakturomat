import type { ExpenseFormInput } from "./types.ts";
import { emptyExpenseDetails } from "./details.ts";

/** Imported data is a reviewable proposal; preserve manually managed fields. */
export function mergeExpenseExtraction(
  current: ExpenseFormInput,
  extracted: ExpenseFormInput,
  preserveMissing = true,
): ExpenseFormInput {
  const result = { ...current, ...extracted };
  for (
    const key of [
      "supplierName",
      "supplierInvoiceNumber",
      "issueDate",
      "taxableSupplyDate",
      "dueDate",
      "description",
      "currency",
      "totalAmount",
    ] as const
  ) {
    if (preserveMissing && !extracted[key]) result[key] = current[key];
  }
  result.categoryId = current.categoryId;
  result.paymentDate = current.paymentDate;
  result.note = current.note;
  result.contactId = current.contactId || extracted.contactId;
  if (preserveMissing && !extracted.vatLines.length) {
    result.vatLines = current.vatLines;
  }
  const before = preserveMissing
    ? current.details ?? emptyExpenseDetails()
    : emptyExpenseDetails();
  const incoming = extracted.details ?? emptyExpenseDetails();
  result.details = {
    items: incoming.items.length ? incoming.items : before.items,
    accountNumber: incoming.iban || incoming.accountNumber
      ? incoming.accountNumber
      : before.accountNumber,
    iban: incoming.iban || incoming.accountNumber ? incoming.iban : before.iban,
    variableSymbol: incoming.variableSymbol || before.variableSymbol,
    constantSymbol: incoming.constantSymbol || before.constantSymbol,
    specificSymbol: incoming.specificSymbol || before.specificSymbol,
  };
  return result;
}
