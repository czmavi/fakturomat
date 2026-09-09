export interface BankAccount {
  id: string;
  organizationId: string;
  name: string;
  bankName: string | null;
  accountPrefix: string | null;
  accountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
  bic: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface BankAccountInput {
  name: string;
  bankName: string;
  accountPrefix: string;
  accountNumber: string;
  bankCode: string;
  iban: string;
  bic: string;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface NormalizedBankAccountInput {
  name: string;
  bankName: string | null;
  accountPrefix: string | null;
  accountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
  bic: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
}

export const BANK_PROVIDERS = ["FIO"] as const;
export type BankProviderType = typeof BANK_PROVIDERS[number];

export const BANK_CONNECTION_STATUSES = [
  "CONFIGURED",
  "ACTIVE",
  "ERROR",
  "DISABLED",
] as const;
export type BankConnectionStatus = typeof BANK_CONNECTION_STATUSES[number];

export interface BankConnection {
  id: string;
  organizationId: string;
  bankAccountId: string;
  provider: BankProviderType;
  status: BankConnectionStatus;
  lastSyncAt: Date | null;
  currentBalance: string | null;
  balanceCurrency: string | null;
  balanceDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BankConnectionWithCredentials extends BankConnection {
  encryptedCredentials: string;
}

export function bankConnectionStatusLabel(
  status: BankConnectionStatus,
): string {
  switch (status) {
    case "CONFIGURED":
      return "Připraveno k první synchronizaci";
    case "ACTIVE":
      return "Aktivní";
    case "ERROR":
      return "Chyba synchronizace";
    case "DISABLED":
      return "Vypnuto";
  }
}

export function formatBankAccount(account: BankAccount): string {
  if (account.accountNumber && account.bankCode) {
    const prefix = account.accountPrefix ? `${account.accountPrefix}-` : "";
    return `${prefix}${account.accountNumber}/${account.bankCode}`;
  }
  return account.iban ?? "—";
}

export function formatBankAmountForDisplay(
  value: string,
  showPositiveSign = true,
): string {
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole, rawFraction = ""] = normalized.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = rawFraction.replace(/0+$/, "").padEnd(2, "0");
  const sign = negative ? "−" : showPositiveSign ? "+" : "";
  return `${sign}${grouped},${fraction}`;
}

export const BANK_TRANSACTION_DIRECTIONS = [
  "ALL",
  "INCOMING",
  "OUTGOING",
] as const;
export type BankTransactionDirection =
  typeof BANK_TRANSACTION_DIRECTIONS[number];

export interface BankTransaction {
  id: string;
  organizationId: string;
  bankAccountId: string;
  bankAccountName: string;
  provider: BankProviderType;
  providerTransactionId: string;
  bookingDate: string;
  amount: string;
  currency: string;
  counterpartyAccount: string | null;
  counterpartyBankCode: string | null;
  counterpartyName: string | null;
  variableSymbol: string | null;
  constantSymbol: string | null;
  specificSymbol: string | null;
  message: string | null;
  rawData: unknown;
  createdAt: Date;
}

export type InvoicePaymentMatchType = "AUTO" | "MANUAL";

export interface InvoicePayment {
  id: string;
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  bankTransactionId: string;
  amount: string;
  matchType: InvoicePaymentMatchType;
  createdBy: string | null;
  createdAt: Date;
}

export interface PaymentInvoiceCandidate {
  id: string;
  number: string;
  contactName: string;
  variableSymbol: string | null;
  currency: string;
  total: string;
  paidAmount: string;
  remainingAmount: string;
}

export interface ExpensePayment {
  id: string;
  organizationId: string;
  expenseId: string;
  expenseSupplierName: string;
  expenseDocumentNumber: string | null;
  bankTransactionId: string;
  amount: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface PaymentExpenseCandidate {
  id: string;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  description: string;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
}
