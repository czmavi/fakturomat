import type { BankAccount } from "@/domain/banking/types.ts";
import type { BankAccountRepository } from "@/repositories/bank_account_repository.ts";
import {
  PostgresBankAccountRepository,
} from "@/repositories/bank_account_repository.ts";
import {
  PostgresBankConnectionRepository,
} from "@/repositories/bank_connection_repository.ts";
import type { BankTransactionRepository } from "@/repositories/bank_transaction_repository.ts";
import {
  PostgresBankTransactionRepository,
} from "@/repositories/bank_transaction_repository.ts";
import {
  PostgresInvoicePaymentRepository,
} from "@/repositories/invoice_payment_repository.ts";
import {
  BankConnectionCredentialError,
  BankConnectionService,
  createBankConnectionService,
} from "@/services/banking/bank_connection_service.ts";
import type {
  BankProvider,
  BankProviderSyncResult,
} from "@/services/banking/bank_provider.ts";
import { BankProviderError } from "@/services/banking/bank_provider.ts";
import { FioBankProvider } from "@/services/banking/fio_bank_provider.ts";
import { InvoicePaymentService } from "@/services/banking/invoice_payment_service.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SYNC_DAYS = 90;

export class BankSyncError extends Error {
  constructor(
    message: string,
    readonly kind: "VALIDATION" | "PROVIDER" | "ACCOUNT_MISMATCH",
  ) {
    super(message);
  }
}

export interface BankSyncSummary {
  fetched: number;
  inserted: number;
  autoMatched: number;
  dateFrom: string;
  dateTo: string;
}

function parseDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function validatePeriod(dateFrom: string, dateTo: string): void {
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (from === null || to === null || from > to) {
    throw new BankSyncError("Období synchronizace není platné.", "VALIDATION");
  }
  const days = Math.floor((to.valueOf() - from.valueOf()) / 86_400_000) + 1;
  if (days > MAX_SYNC_DAYS) {
    throw new BankSyncError(
      `Jedna synchronizace může zahrnovat nejvýše ${MAX_SYNC_DAYS} dní.`,
      "VALIDATION",
    );
  }
}

function normalizeIban(value: string): string {
  return value.replaceAll(/\s/g, "").toUpperCase();
}

function normalizeAccountNumber(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function matchesAccount(
  account: BankAccount,
  result: BankProviderSyncResult,
): boolean {
  if (result.currency && result.currency !== account.currency) return false;
  if (result.transactions.some((item) => item.currency !== account.currency)) {
    return false;
  }
  if (account.iban && result.iban) {
    return normalizeIban(account.iban) === normalizeIban(result.iban);
  }
  if (
    account.bankCode && result.bankId &&
    account.bankCode !== result.bankId
  ) {
    return false;
  }
  if (account.accountNumber && result.accountId) {
    return normalizeAccountNumber(account.accountNumber) ===
      normalizeAccountNumber(result.accountId);
  }
  return true;
}

export class BankSyncService {
  constructor(
    private readonly connectionService: BankConnectionService,
    private readonly bankAccountRepository: BankAccountRepository,
    private readonly transactionRepository: BankTransactionRepository,
    private readonly provider: BankProvider,
    private readonly paymentService: InvoicePaymentService,
  ) {}

  async sync(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<BankSyncSummary | null> {
    validatePeriod(input.dateFrom, input.dateTo);
    const account = await this.bankAccountRepository.findForUser(
      input.organizationId,
      input.bankAccountId,
      input.userId,
    );
    if (account === null) return null;

    let credentials;
    try {
      credentials = await this.connectionService.credentialsForSync(input);
    } catch (error) {
      if (error instanceof BankConnectionCredentialError) {
        await this.markError(input);
        throw new BankSyncError(error.message, "PROVIDER");
      }
      throw error;
    }
    if (credentials === null) return null;

    let result: BankProviderSyncResult;
    try {
      result = await this.provider.syncTransactions({
        token: credentials.token,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      });
    } catch (error) {
      if (error instanceof BankProviderError) {
        if (
          error.kind === "INVALID_CREDENTIALS" ||
          error.kind === "INVALID_RESPONSE"
        ) {
          await this.markError(input);
        }
        throw new BankSyncError(error.message, "PROVIDER");
      }
      throw error;
    }

    if (!matchesAccount(account, result)) {
      await this.markError(input);
      throw new BankSyncError(
        "Fio token patří k jinému účtu nebo měně.",
        "ACCOUNT_MISMATCH",
      );
    }
    const imported = await this.transactionRepository.importForUser({
      organizationId: input.organizationId,
      bankAccountId: input.bankAccountId,
      userId: input.userId,
      provider: credentials.connection.provider,
      transactions: result.transactions,
      balance: result.closingBalance && result.currency
        ? {
          amount: result.closingBalance,
          currency: result.currency,
          date: input.dateTo,
        }
        : null,
    });
    if (imported === null) return null;
    const autoMatched = await this.paymentService.autoMatchForUser({
      organizationId: input.organizationId,
      userId: input.userId,
      bankAccountId: input.bankAccountId,
    });
    if (autoMatched === null) return null;
    return {
      fetched: result.transactions.length,
      inserted: imported.inserted,
      autoMatched,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    };
  }

  private async markError(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
  }): Promise<void> {
    await this.transactionRepository.markConnectionErrorForUser({
      ...input,
      provider: this.provider.provider,
    });
  }
}

export function createBankSyncService(): BankSyncService {
  const connectionRepository = new PostgresBankConnectionRepository();
  return new BankSyncService(
    createBankConnectionService(connectionRepository),
    new PostgresBankAccountRepository(),
    new PostgresBankTransactionRepository(),
    new FioBankProvider(),
    new InvoicePaymentService(new PostgresInvoicePaymentRepository()),
  );
}
