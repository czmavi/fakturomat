import type {
  BankTransaction,
  InvoicePayment,
  PaymentInvoiceCandidate,
} from "@/domain/banking/types.ts";
import type {
  InvoicePaymentRepository,
  ManualInvoiceMatchResult,
} from "@/repositories/invoice_payment_repository.ts";

const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,4}))?$/;

function decimalUnits(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error("Invalid persisted decimal amount");
  const negative = value.startsWith("-");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(4, "0") || "0");
  const units = whole * 10_000n + fraction;
  return negative ? -units : units;
}

export interface InvoicePaymentSuggestion {
  invoice: PaymentInvoiceCandidate;
  variableSymbolMatches: boolean;
  amountMatches: boolean;
}

export function transactionRemainingAmount(
  transaction: BankTransaction,
  payments: InvoicePayment[],
): bigint {
  return decimalUnits(transaction.amount) - payments
    .filter((payment) => payment.bankTransactionId === transaction.id)
    .reduce((sum, payment) => sum + decimalUnits(payment.amount), 0n);
}

export function suggestInvoicePayments(
  transaction: BankTransaction,
  payments: InvoicePayment[],
  candidates: PaymentInvoiceCandidate[],
): InvoicePaymentSuggestion[] {
  const remaining = transactionRemainingAmount(transaction, payments);
  if (remaining <= 0n) return [];
  return candidates
    .filter((invoice) => invoice.currency === transaction.currency)
    .map((invoice) => {
      const variableSymbolMatches = transaction.variableSymbol !== null &&
        invoice.variableSymbol === transaction.variableSymbol;
      const amountMatches = decimalUnits(invoice.remainingAmount) === remaining;
      return { invoice, variableSymbolMatches, amountMatches };
    })
    .filter((suggestion) =>
      suggestion.variableSymbolMatches || suggestion.amountMatches
    )
    .sort((left, right) => {
      const leftScore = Number(left.variableSymbolMatches) * 2 +
        Number(left.amountMatches);
      const rightScore = Number(right.variableSymbolMatches) * 2 +
        Number(right.amountMatches);
      return rightScore - leftScore ||
        left.invoice.number.localeCompare(right.invoice.number, "cs-CZ");
    })
    .slice(0, 5);
}

export class InvoicePaymentService {
  constructor(private readonly repository: InvoicePaymentRepository) {}

  autoMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankAccountId: string | null;
  }): Promise<number | null> {
    return this.repository.autoMatchForUser(input);
  }

  manualMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankTransactionId: string;
    invoiceId: string;
  }): Promise<ManualInvoiceMatchResult> {
    return this.repository.manualMatchForUser(input);
  }

  unmatchForUser(input: {
    organizationId: string;
    userId: string;
    paymentId: string;
  }): Promise<boolean> {
    return this.repository.unmatchForUser(input);
  }
}
