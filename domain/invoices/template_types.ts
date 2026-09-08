export const TEMPLATE_PLACEHOLDERS = [
  "supplier.name",
  "supplier.ico",
  "supplier.dic",
  "supplier.address",
  "supplier.email",
  "supplier.phone",
  "supplier.website",
  "supplier.logo",
  "customer.name",
  "customer.ico",
  "customer.dic",
  "customer.address",
  "invoice.number",
  "invoice.issueDate",
  "invoice.dueDate",
  "invoice.variableSymbol",
  "invoice.currency",
  "invoice.subtotal",
  "invoice.total",
  "invoice.note",
  "payment.account",
  "payment.iban",
  "payment.qr",
  "invoice.items",
] as const;

export type TemplatePlaceholder = typeof TEMPLATE_PLACEHOLDERS[number];

export interface InvoiceTemplate {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  currentVersionId: string;
  currentVersion: number;
  updatedAt: Date;
}

export interface InvoiceTemplateVersion {
  id: string;
  invoiceTemplateId: string;
  version: number;
  html: string;
  css: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface InvoiceTemplateInput {
  name: string;
  description: string;
  html: string;
  css: string;
}
