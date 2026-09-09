export const EXPENSE_DOCUMENT_TYPES = ["INVOICE", "RECEIPT", "OTHER"] as const;
export type ExpenseDocumentType = typeof EXPENSE_DOCUMENT_TYPES[number];

export interface ExpenseCategory {
  id: string;
  organizationId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseCategoryInput {
  name: string;
  isActive: boolean;
}

export interface ExpenseVatLine {
  id: string;
  expenseId: string;
  position: number;
  vatRate: string;
  baseAmount: string;
  vatAmount: string;
}

export interface ExpenseVatLineFormInput {
  vatRate: string;
  baseAmount: string;
  vatAmount: string;
}

export interface NormalizedExpenseVatLineInput {
  id: string;
  position: number;
  vatRate: string;
  baseAmount: string;
  vatAmount: string;
}

export interface ExpenseSummary {
  id: string;
  organizationId: string;
  contactId: string | null;
  contactName: string | null;
  documentType: ExpenseDocumentType;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  issueDate: string | null;
  taxableSupplyDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  currency: string;
  totalAmount: string;
  vatBaseTotal: string;
  vatAmountTotal: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Expense extends ExpenseSummary {
  vatLines: ExpenseVatLine[];
}

export interface ExpenseFormInput {
  contactId: string;
  documentType: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  issueDate: string;
  taxableSupplyDate: string;
  dueDate: string;
  paymentDate: string;
  description: string;
  categoryId: string;
  currency: string;
  totalAmount: string;
  note: string;
  vatLines: ExpenseVatLineFormInput[];
}

export interface NormalizedExpenseInput {
  contactId: string | null;
  documentType: ExpenseDocumentType;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  issueDate: string | null;
  taxableSupplyDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  description: string;
  categoryId: string | null;
  currency: string;
  totalAmount: string;
  note: string | null;
  vatLines: NormalizedExpenseVatLineInput[];
}

export function isExpenseDocumentType(
  value: string,
): value is ExpenseDocumentType {
  return (EXPENSE_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function expenseDocumentTypeLabel(type: ExpenseDocumentType): string {
  switch (type) {
    case "INVOICE":
      return "Přijatá faktura";
    case "RECEIPT":
      return "Účtenka";
    case "OTHER":
      return "Ostatní náklad";
  }
}
