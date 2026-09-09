import type {
  InvoiceNumberSequence,
  InvoiceNumberSequenceInput,
  NormalizedInvoiceNumberSequenceInput,
} from "@/domain/invoices/number_sequence_types.ts";
import type { InvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";

export class InvoiceNumberSequenceValidationError extends Error {}

export function normalizeInvoiceNumberSequenceInput(
  input: InvoiceNumberSequenceInput,
): NormalizedInvoiceNumberSequenceInput {
  const name = input.name.trim();
  const prefix = input.prefix.trim().toLocaleUpperCase("en-US");
  const padding = Number(input.padding);

  if (name.length < 2 || name.length > 100) {
    throw new InvoiceNumberSequenceValidationError(
      "Název musí mít 2 až 100 znaků.",
    );
  }
  if (!/^[A-Z0-9._/-]{0,20}$/.test(prefix)) {
    throw new InvoiceNumberSequenceValidationError(
      "Prefix může obsahovat jen písmena, číslice, tečku, lomítko, podtržítko a pomlčku.",
    );
  }
  if (!Number.isInteger(padding) || padding < 1 || padding > 9) {
    throw new InvoiceNumberSequenceValidationError(
      "Počet číslic pořadového čísla musí být 1 až 9.",
    );
  }
  if (input.isDefault && !input.isActive) {
    throw new InvoiceNumberSequenceValidationError(
      "Výchozí číselná řada musí být aktivní.",
    );
  }
  return {
    name,
    prefix,
    padding,
    isDefault: input.isDefault,
    isActive: input.isActive,
  };
}

export class InvoiceNumberSequenceService {
  constructor(private readonly repository: InvoiceNumberSequenceRepository) {}

  async create(
    input: InvoiceNumberSequenceInput & {
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null> {
    return await this.repository.createForUser({
      ...normalizeInvoiceNumberSequenceInput(input),
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  async update(
    input: InvoiceNumberSequenceInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null> {
    return await this.repository.updateForUser({
      ...normalizeInvoiceNumberSequenceInput(input),
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }
}
