export const DASHBOARD_PERIOD_PRESETS = [
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_YEAR",
  "CUSTOM",
] as const;

export type DashboardPeriodPreset = typeof DASHBOARD_PERIOD_PRESETS[number];

export interface DashboardPeriod {
  preset: DashboardPeriodPreset;
  dateFrom: string;
  dateTo: string;
}

export interface CurrencyAmount {
  currency: string;
  amount: string;
}

export interface DashboardBankBalance {
  bankAccountId: string;
  bankAccountName: string;
  amount: string;
  currency: string;
  date: string;
}

export interface DashboardOverview {
  bankBalances: DashboardBankBalance[];
  issuedInvoiceCount: number;
  issuedInvoiceTotals: CurrencyAmount[];
  unpaidInvoiceCount: number;
  unpaidInvoiceTotals: CurrencyAmount[];
  overdueInvoiceCount: number;
  overdueInvoiceTotals: CurrencyAmount[];
  incomeTotals: CurrencyAmount[];
  expenseTotals: CurrencyAmount[];
  cashflowTotals: CurrencyAmount[];
  unmatchedTransactionCount: number;
  unmatchedIncomingCount: number;
  unmatchedOutgoingCount: number;
}
