export interface InvoiceNumberSequence {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  padding: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceNumberSequenceInput {
  name: string;
  prefix: string;
  padding: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface NormalizedInvoiceNumberSequenceInput {
  name: string;
  prefix: string;
  padding: number;
  isDefault: boolean;
  isActive: boolean;
}

export function formatInvoiceNumber(
  sequence: Pick<InvoiceNumberSequence, "prefix" | "padding">,
  year: number,
  value: bigint,
): string {
  return `${sequence.prefix}${year}-${
    value.toString().padStart(sequence.padding, "0")
  }`;
}
