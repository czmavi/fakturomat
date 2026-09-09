import {
  formatMoneyFromMinorUnits,
  parseMoneyToMinorUnits,
} from "@/domain/invoices/money.ts";
import type {
  ExpenseVatLineFormInput,
  NormalizedExpenseVatLineInput,
} from "@/domain/expenses/types.ts";

const VAT_RATE_PATTERN = /^(0|[1-9][0-9]{0,2})(?:[.,]([0-9]{1,4}))?$/;

export class VatLineValidationError extends Error {}

export function normalizeVatRate(value: string): string {
  const match = VAT_RATE_PATTERN.exec(value.trim());
  if (!match) {
    throw new VatLineValidationError(
      "Sazba DPH musí být nezáporné číslo s nejvýše čtyřmi desetinnými místy.",
    );
  }
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction === "" ? match[1] : `${match[1]}.${fraction}`;
}

export function normalizeVatLines(
  lines: ExpenseVatLineFormInput[],
): NormalizedExpenseVatLineInput[] {
  if (lines.length > 100) {
    throw new VatLineValidationError(
      "Jeden doklad může obsahovat nejvýše 100 řádků DPH.",
    );
  }
  return lines.map((line, index) => {
    let baseMinorUnits: bigint;
    let vatMinorUnits: bigint;
    try {
      baseMinorUnits = parseMoneyToMinorUnits(line.baseAmount);
      vatMinorUnits = parseMoneyToMinorUnits(line.vatAmount);
    } catch {
      throw new VatLineValidationError(
        `Řádek DPH ${index + 1} obsahuje neplatnou částku.`,
      );
    }
    return {
      id: crypto.randomUUID(),
      position: index + 1,
      vatRate: normalizeVatRate(line.vatRate),
      baseAmount: formatMoneyFromMinorUnits(baseMinorUnits),
      vatAmount: formatMoneyFromMinorUnits(vatMinorUnits),
    };
  });
}

export function sumVatLines(lines: {
  baseAmount: string;
  vatAmount: string;
}[]): {
  baseMinorUnits: bigint;
  vatMinorUnits: bigint;
  combinedMinorUnits: bigint;
} {
  return lines.reduce(
    (totals, line) => {
      const base = parseMoneyToMinorUnits(line.baseAmount);
      const vat = parseMoneyToMinorUnits(line.vatAmount);
      return {
        baseMinorUnits: totals.baseMinorUnits + base,
        vatMinorUnits: totals.vatMinorUnits + vat,
        combinedMinorUnits: totals.combinedMinorUnits + base + vat,
      };
    },
    { baseMinorUnits: 0n, vatMinorUnits: 0n, combinedMinorUnits: 0n },
  );
}
