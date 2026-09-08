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

export function formatBankAccount(account: BankAccount): string {
  if (account.accountNumber && account.bankCode) {
    const prefix = account.accountPrefix ? `${account.accountPrefix}-` : "";
    return `${prefix}${account.accountNumber}/${account.bankCode}`;
  }
  return account.iban ?? "—";
}
