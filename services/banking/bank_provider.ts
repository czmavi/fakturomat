import type { BankProviderType } from "@/domain/banking/types.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface BankProviderTransaction {
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
  rawData: JsonValue;
}

export interface BankProviderSyncResult {
  accountId: string | null;
  bankId: string | null;
  iban: string | null;
  currency: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  transactions: BankProviderTransaction[];
}

export interface BankProvider {
  readonly provider: BankProviderType;
  syncTransactions(input: {
    token: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<BankProviderSyncResult>;
}

export class BankProviderError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "INVALID_REQUEST"
      | "INVALID_CREDENTIALS"
      | "RATE_LIMITED"
      | "UNAVAILABLE"
      | "INVALID_RESPONSE",
  ) {
    super(message);
  }
}
