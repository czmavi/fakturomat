import type {
  BankTransaction,
  ExpensePayment,
  PaymentExpenseCandidate,
} from "@/domain/banking/types.ts";
import type {
  ExpensePaymentRepository,
  ManualExpenseMatchResult,
} from "@/repositories/expense_payment_repository.ts";

const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,4}))?$/;

function decimalUnits(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error("Invalid persisted decimal amount");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(4, "0") || "0");
  const units = whole * 10_000n + fraction;
  return value.startsWith("-") ? -units : units;
}

function documentVariableSymbol(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replaceAll(/\D/g, "").slice(-10);
  return digits === "" ? null : digits;
}

export interface ExpensePaymentSuggestion {
  expense: PaymentExpenseCandidate;
  variableSymbolMatches: boolean;
  amountMatches: boolean;
}

export function outgoingTransactionRemainingAmount(
  transaction: BankTransaction,
  payments: ExpensePayment[],
): bigint {
  const absoluteAmount = -decimalUnits(transaction.amount);
  return absoluteAmount - payments
    .filter((payment) => payment.bankTransactionId === transaction.id)
    .reduce((sum, payment) => sum + decimalUnits(payment.amount), 0n);
}

export function suggestExpensePayments(
  transaction: BankTransaction,
  payments: ExpensePayment[],
  candidates: PaymentExpenseCandidate[],
): ExpensePaymentSuggestion[] {
  const remaining = outgoingTransactionRemainingAmount(transaction, payments);
  if (remaining <= 0n) return [];
  return candidates
    .filter((expense) => expense.currency === transaction.currency)
    .map((expense) => {
      const variableSymbolMatches = transaction.variableSymbol !== null &&
        documentVariableSymbol(expense.supplierInvoiceNumber) ===
          transaction.variableSymbol;
      const amountMatches = decimalUnits(expense.remainingAmount) === remaining;
      return { expense, variableSymbolMatches, amountMatches };
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
        left.expense.supplierName.localeCompare(
          right.expense.supplierName,
          "cs-CZ",
        );
    })
    .slice(0, 5);
}

export class ExpensePaymentService {
  constructor(private readonly repository: ExpensePaymentRepository) {}

  manualMatchForUser(input: {
    organizationId: string;
    userId: string;
    bankTransactionId: string;
    expenseId: string;
  }): Promise<ManualExpenseMatchResult> {
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
