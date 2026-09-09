import { isUuid } from "@/domain/organizations/types.ts";
import {
  normalizeMoney,
  parseMoneyToMinorUnits,
} from "@/domain/invoices/money.ts";
import {
  type Expense,
  type ExpenseFormInput,
  isExpenseDocumentType,
  type NormalizedExpenseInput,
} from "@/domain/expenses/types.ts";
import {
  normalizeVatLines,
  VatLineValidationError,
} from "@/domain/expenses/vat.ts";
import type { ExpenseRepository } from "@/repositories/expense_repository.ts";

export class ExpenseValidationError extends Error {}

const MAX_TOTAL_MINOR_UNITS = 999_999_999_999_999_999n;

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validOptionalDate(value: string): boolean {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

export function normalizeExpenseInput(
  input: ExpenseFormInput,
): NormalizedExpenseInput {
  if (!isExpenseDocumentType(input.documentType)) {
    throw new ExpenseValidationError("Vyberte platný typ dokladu.");
  }
  if (input.contactId !== "" && !isUuid(input.contactId)) {
    throw new ExpenseValidationError("Vyberte platný kontakt.");
  }
  if (input.categoryId !== "" && !isUuid(input.categoryId)) {
    throw new ExpenseValidationError("Vyberte platnou kategorii.");
  }
  const supplierName = input.supplierName.trim();
  if (supplierName.length < 2 || supplierName.length > 200) {
    throw new ExpenseValidationError(
      "Název dodavatele musí mít 2 až 200 znaků.",
    );
  }
  const supplierInvoiceNumber = nullable(input.supplierInvoiceNumber);
  if (supplierInvoiceNumber && supplierInvoiceNumber.length > 100) {
    throw new ExpenseValidationError("Číslo dokladu je příliš dlouhé.");
  }
  for (
    const value of [
      input.issueDate,
      input.taxableSupplyDate,
      input.dueDate,
      input.paymentDate,
    ]
  ) {
    if (!validOptionalDate(value)) {
      throw new ExpenseValidationError("Některé zadané datum není platné.");
    }
  }
  const description = input.description.trim();
  if (description.length === 0 || description.length > 1_000) {
    throw new ExpenseValidationError("Popis musí mít 1 až 1 000 znaků.");
  }
  const currency = input.currency.trim().toLocaleUpperCase("en-US");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ExpenseValidationError("Měna musí být třípísmenný ISO kód.");
  }
  let totalMinorUnits: bigint;
  let totalAmount: string;
  try {
    totalMinorUnits = parseMoneyToMinorUnits(input.totalAmount);
    totalAmount = normalizeMoney(input.totalAmount);
  } catch {
    throw new ExpenseValidationError("Celková částka nemá platný formát.");
  }
  if (totalMinorUnits > MAX_TOTAL_MINOR_UNITS) {
    throw new ExpenseValidationError("Celková částka je příliš vysoká.");
  }
  const note = nullable(input.note);
  if (note && note.length > 5_000) {
    throw new ExpenseValidationError("Poznámka může mít nejvýše 5 000 znaků.");
  }
  let vatLines;
  try {
    vatLines = normalizeVatLines(input.vatLines);
  } catch (error) {
    if (error instanceof VatLineValidationError) {
      throw new ExpenseValidationError(error.message);
    }
    throw error;
  }
  return {
    contactId: nullable(input.contactId),
    documentType: input.documentType,
    supplierName,
    supplierInvoiceNumber,
    issueDate: nullable(input.issueDate),
    taxableSupplyDate: nullable(input.taxableSupplyDate),
    dueDate: nullable(input.dueDate),
    paymentDate: nullable(input.paymentDate),
    description,
    categoryId: nullable(input.categoryId),
    currency,
    totalAmount,
    note,
    vatLines,
  };
}

export class ExpenseService {
  constructor(private readonly repository: ExpenseRepository) {}

  async create(
    input: ExpenseFormInput & { organizationId: string; userId: string },
  ): Promise<Expense | null> {
    return await this.repository.createForUser({
      ...normalizeExpenseInput(input),
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  async update(
    input: ExpenseFormInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Expense | null> {
    return await this.repository.updateForUser({
      ...normalizeExpenseInput(input),
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }
}
