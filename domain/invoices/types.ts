export const INVOICE_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PAID",
  "CANCELLED",
] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
  position: number;
}

export interface SupplierSnapshot {
  [key: string]: string | null;
  officialName: string;
  displayName: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoStorageKey: string | null;
  logoMimeType: string | null;
  invoiceFooter: string | null;
}

export interface CustomerSnapshot {
  [key: string]: string | null;
  type: string;
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  email: string | null;
  phone: string | null;
}

export interface BankAccountSnapshot {
  [key: string]: string | null;
  name: string;
  bankName: string | null;
  accountPrefix: string | null;
  accountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
  bic: string | null;
  currency: string;
}

export interface Invoice {
  id: string;
  organizationId: string;
  contactId: string;
  contactName: string;
  numberSequenceId: string;
  numberSequenceName: string;
  bankAccountId: string | null;
  bankAccountName: string | null;
  invoiceTemplateId: string;
  invoiceTemplateName: string;
  templateVersionId: string | null;
  templateVersionNumber: number | null;
  number: string | null;
  variableSymbol: string | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  total: string;
  note: string | null;
  supplierSnapshot: SupplierSnapshot | null;
  customerSnapshot: CustomerSnapshot | null;
  bankAccountSnapshot: BankAccountSnapshot | null;
  issuedAt: Date | null;
  issuedBy: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: InvoiceItem[];
}

export type InvoiceSummary = Omit<Invoice, "items">;

export interface InvoiceItemFormInput {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface InvoiceDraftFormInput {
  contactId: string;
  numberSequenceId: string;
  bankAccountId: string;
  invoiceTemplateId: string;
  variableSymbol: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  note: string;
  items: InvoiceItemFormInput[];
}

export interface NormalizedInvoiceItemInput {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  total: string;
  position: number;
}

export interface NormalizedInvoiceDraftInput {
  contactId: string;
  numberSequenceId: string;
  bankAccountId: string | null;
  invoiceTemplateId: string;
  variableSymbol: string | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  total: string;
  note: string | null;
  items: NormalizedInvoiceItemInput[];
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  switch (status) {
    case "DRAFT":
      return "Koncept";
    case "ISSUED":
      return "Vystavená";
    case "PAID":
      return "Zaplacená";
    case "CANCELLED":
      return "Stornovaná";
  }
}
