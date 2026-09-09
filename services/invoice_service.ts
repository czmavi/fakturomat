import { isUuid } from "@/domain/organizations/types.ts";
import {
  DecimalValidationError,
  formatMoneyFromMinorUnits,
  multiplyMoneyByQuantity,
  normalizeMoney,
  normalizeQuantity,
  parseMoneyToMinorUnits,
  parseQuantityToUnits,
} from "@/domain/invoices/money.ts";
import type {
  Invoice,
  InvoiceDraftFormInput,
  NormalizedInvoiceDraftInput,
  NormalizedInvoiceItemInput,
} from "@/domain/invoices/types.ts";
import type { InvoiceRepository } from "@/repositories/invoice_repository.ts";
import type { IssueInvoiceResult } from "@/repositories/invoice_repository.ts";
import type { InvoiceDocumentPreparer } from "@/domain/invoices/invoice_document.ts";
import { InvoiceDocumentGenerationError } from "@/services/invoice_document_service.ts";

export class InvoiceValidationError extends Error {}

const MAX_TOTAL_MINOR_UNITS = 999_999_999_999_999_999n;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeInvoiceDraftInput(
  input: InvoiceDraftFormInput,
): NormalizedInvoiceDraftInput {
  if (
    !isUuid(input.contactId) || !isUuid(input.numberSequenceId) ||
    !isUuid(input.invoiceTemplateId) ||
    (input.bankAccountId !== "" && !isUuid(input.bankAccountId))
  ) {
    throw new InvoiceValidationError("Vyberte platné fakturační údaje.");
  }
  if (!validDate(input.issueDate) || !validDate(input.dueDate)) {
    throw new InvoiceValidationError(
      "Zadejte platné datum vystavení a splatnosti.",
    );
  }
  if (input.dueDate < input.issueDate) {
    throw new InvoiceValidationError(
      "Datum splatnosti nesmí předcházet datu vystavení.",
    );
  }
  const currency = input.currency.trim().toLocaleUpperCase("en-US");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvoiceValidationError("Měna musí být třípísmenný ISO kód.");
  }
  const variableSymbol = nullable(input.variableSymbol);
  if (variableSymbol && !/^[0-9]{1,10}$/.test(variableSymbol)) {
    throw new InvoiceValidationError(
      "Variabilní symbol může mít nejvýše 10 číslic.",
    );
  }
  const note = nullable(input.note);
  if (note && note.length > 2_000) {
    throw new InvoiceValidationError("Poznámka může mít nejvýše 2 000 znaků.");
  }

  const nonEmptyItems = input.items.filter((item) =>
    [item.description, item.quantity, item.unit, item.unitPrice].some((value) =>
      value.trim() !== ""
    )
  );
  if (nonEmptyItems.length === 0 || nonEmptyItems.length > 100) {
    throw new InvoiceValidationError("Faktura musí mít 1 až 100 položek.");
  }

  let subtotalMinorUnits = 0n;
  let items: NormalizedInvoiceItemInput[];
  try {
    items = nonEmptyItems.map((item, index) => {
      const description = item.description.trim();
      const unit = item.unit.trim();
      if (description.length === 0 || description.length > 500) {
        throw new InvoiceValidationError(
          `Položka ${index + 1}: popis musí mít 1 až 500 znaků.`,
        );
      }
      if (unit.length === 0 || unit.length > 30) {
        throw new InvoiceValidationError(
          `Položka ${index + 1}: jednotka musí mít 1 až 30 znaků.`,
        );
      }
      const quantityUnits = parseQuantityToUnits(item.quantity);
      if (quantityUnits <= 0n) {
        throw new InvoiceValidationError(
          `Položka ${index + 1}: množství musí být větší než nula.`,
        );
      }
      const unitPriceMinorUnits = parseMoneyToMinorUnits(item.unitPrice);
      const totalMinorUnits = multiplyMoneyByQuantity(
        unitPriceMinorUnits,
        quantityUnits,
      );
      subtotalMinorUnits += totalMinorUnits;
      return {
        id: crypto.randomUUID(),
        description,
        quantity: normalizeQuantity(item.quantity),
        unit,
        unitPrice: normalizeMoney(item.unitPrice),
        total: formatMoneyFromMinorUnits(totalMinorUnits),
        position: index + 1,
      };
    });
  } catch (error) {
    if (error instanceof DecimalValidationError) {
      throw new InvoiceValidationError(error.message);
    }
    throw error;
  }
  if (subtotalMinorUnits > MAX_TOTAL_MINOR_UNITS) {
    throw new InvoiceValidationError("Celková částka je příliš vysoká.");
  }
  const subtotal = formatMoneyFromMinorUnits(subtotalMinorUnits);
  return {
    contactId: input.contactId,
    numberSequenceId: input.numberSequenceId,
    bankAccountId: nullable(input.bankAccountId),
    invoiceTemplateId: input.invoiceTemplateId,
    variableSymbol,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency,
    subtotal,
    total: subtotal,
    note,
    items,
  };
}

export class InvoiceService {
  constructor(
    private readonly repository: InvoiceRepository,
    private readonly documentPreparer?: InvoiceDocumentPreparer,
  ) {}

  async createDraft(
    input: InvoiceDraftFormInput & {
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null> {
    return await this.repository.createDraftForUser({
      ...normalizeInvoiceDraftInput(input),
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  async updateDraft(
    input: InvoiceDraftFormInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null> {
    return await this.repository.updateDraftForUser({
      ...normalizeInvoiceDraftInput(input),
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  async issue(input: {
    id: string;
    organizationId: string;
    userId: string;
  }): Promise<IssueInvoiceResult> {
    if (!this.documentPreparer) return { kind: "pdf_generation_failed" };
    try {
      return await this.repository.issueForUser({
        invoiceId: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
      }, this.documentPreparer);
    } catch (error) {
      if (error instanceof InvoiceDocumentGenerationError) {
        return { kind: "pdf_generation_failed" };
      }
      throw error;
    }
  }
}
