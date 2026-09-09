import {
  type BankProvider,
  BankProviderError,
  type BankProviderSyncResult,
  type BankProviderTransaction,
  type JsonValue,
} from "@/services/banking/bank_provider.ts";

const FIO_API_BASE_URL = "https://fioapi.fio.cz/v1/rest";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^-?(0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/;

type JsonObject = { [key: string]: JsonValue };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: JsonValue | undefined): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function cell(transaction: JsonObject, column: string): string | number | null {
  const entry = transaction[column];
  if (!isObject(entry)) return null;
  return scalar(entry.value);
}

function optionalString(value: string | number | null): string | null {
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function bookingDate(value: string | number | null): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? null
      : date.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const candidate = value.slice(0, 10);
    if (DATE_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

function amount(value: string | number | null): string | null {
  if (value === null) return null;
  const normalized = String(value).trim();
  return AMOUNT_PATTERN.test(normalized) ? normalized : null;
}

function parseTransaction(value: JsonValue): BankProviderTransaction {
  if (!isObject(value)) {
    throw new BankProviderError(
      "Fio API vrátilo neplatný pohyb.",
      "INVALID_RESPONSE",
    );
  }
  const providerTransactionId = optionalString(cell(value, "column22"));
  const date = bookingDate(cell(value, "column0"));
  const transactionAmount = amount(cell(value, "column1"));
  const currency = optionalString(cell(value, "column14"))?.toUpperCase() ??
    null;
  if (
    providerTransactionId === null || date === null ||
    transactionAmount === null || currency === null ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new BankProviderError(
      "Fio API vrátilo pohyb bez povinných údajů.",
      "INVALID_RESPONSE",
    );
  }
  return {
    providerTransactionId,
    bookingDate: date,
    amount: transactionAmount,
    currency,
    counterpartyAccount: optionalString(cell(value, "column2")),
    counterpartyBankCode: optionalString(cell(value, "column3")),
    counterpartyName: optionalString(cell(value, "column10")),
    constantSymbol: optionalString(cell(value, "column4")),
    variableSymbol: optionalString(cell(value, "column5")),
    specificSymbol: optionalString(cell(value, "column6")),
    message: optionalString(cell(value, "column16")) ??
      optionalString(cell(value, "column25")),
    rawData: value,
  };
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

export class FioBankProvider implements BankProvider {
  readonly provider = "FIO" as const;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  async syncTransactions(input: {
    token: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<BankProviderSyncResult> {
    if (
      !validDate(input.dateFrom) || !validDate(input.dateTo) ||
      input.dateFrom > input.dateTo
    ) {
      throw new BankProviderError(
        "Období synchronizace není platné.",
        "INVALID_REQUEST",
      );
    }
    const token = input.token.trim();
    if (
      token.length < 16 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)
    ) {
      throw new BankProviderError(
        "Fio API token nemá platný formát.",
        "INVALID_CREDENTIALS",
      );
    }
    const url = `${FIO_API_BASE_URL}/periods/${
      encodeURIComponent(token)
    }/${input.dateFrom}/${input.dateTo}/transactions.json`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new BankProviderError(
        "Fio API není momentálně dostupné.",
        "UNAVAILABLE",
      );
    }
    if (response.status === 409) {
      throw new BankProviderError(
        "Fio API dovoluje použití tokenu nejvýše jednou za 30 sekund.",
        "RATE_LIMITED",
      );
    }
    if (
      response.status === 500 || response.status === 401 ||
      response.status === 403
    ) {
      throw new BankProviderError(
        "Fio API token je neplatný nebo neaktivní.",
        "INVALID_CREDENTIALS",
      );
    }
    if (!response.ok) {
      throw new BankProviderError(
        "Fio API vrátilo neočekávanou odpověď.",
        "UNAVAILABLE",
      );
    }
    let payload: JsonValue;
    try {
      payload = JSON.parse(await response.text()) as JsonValue;
    } catch {
      throw new BankProviderError(
        "Fio API vrátilo neplatný JSON.",
        "INVALID_RESPONSE",
      );
    }
    if (!isObject(payload) || !isObject(payload.accountStatement)) {
      throw new BankProviderError(
        "Fio API odpověď neobsahuje výpis.",
        "INVALID_RESPONSE",
      );
    }
    const statement = payload.accountStatement;
    const info = isObject(statement.info) ? statement.info : {};
    const transactionList = isObject(statement.transactionList)
      ? statement.transactionList
      : {};
    const transactionPayload = transactionList.transaction;
    const rawTransactions = Array.isArray(transactionPayload)
      ? transactionPayload
      : isObject(transactionPayload)
      ? [transactionPayload]
      : transactionPayload === undefined || transactionPayload === null
      ? []
      : null;
    if (rawTransactions === null) {
      throw new BankProviderError(
        "Fio API vrátilo neplatný seznam pohybů.",
        "INVALID_RESPONSE",
      );
    }
    return {
      accountId: optionalString(scalar(info.accountId)),
      bankId: optionalString(scalar(info.bankId)),
      iban: optionalString(scalar(info.iban)),
      currency: optionalString(scalar(info.currency))?.toUpperCase() ?? null,
      openingBalance: amount(scalar(info.openingBalance)),
      closingBalance: amount(scalar(info.closingBalance)),
      transactions: rawTransactions.map(parseTransaction),
    };
  }
}
