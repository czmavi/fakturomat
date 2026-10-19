import { normalizeMoney, normalizeQuantity } from "@/domain/invoices/money.ts";
import { normalizeVatRate } from "@/domain/expenses/vat.ts";
import {
  czechAccountFromIban,
  czechAccountToIban,
  isValidIban,
  normalizeIban,
} from "@/domain/banking/account_number.ts";

export interface ExpenseItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  totalAmount: string;
}
export interface ExpenseDetails {
  items: ExpenseItem[];
  accountNumber: string;
  iban: string;
  variableSymbol: string;
  constantSymbol: string;
  specificSymbol: string;
}
export const emptyExpenseDetails = (): ExpenseDetails => ({
  items: [],
  accountNumber: "",
  iban: "",
  variableSymbol: "",
  constantSymbol: "",
  specificSymbol: "",
});

export function normalizeExpenseDetails(
  input?: ExpenseDetails,
): ExpenseDetails {
  const data = input ?? emptyExpenseDetails();
  if (!Array.isArray(data.items) || data.items.length > 200) {
    throw new Error("Náklad může mít nejvýše 200 položek.");
  }
  const result = {
    ...data,
    items: data.items.map((item, i) => {
      const description = item.description.trim();
      const unit = item.unit.trim();
      if (
        !description || description.length > 1000 || unit.length > 30
      ) {
        throw new Error(`Položka ${i + 1} má neplatný popis nebo jednotku.`);
      }
      try {
        return {
          description,
          unit,
          quantity: item.quantity.trim()
            ? normalizeQuantity(item.quantity)
            : "",
          unitPrice: item.unitPrice.trim()
            ? normalizeMoney(item.unitPrice)
            : "",
          vatRate: item.vatRate.trim()
            ? normalizeVatRate(item.vatRate.trim().replace(/\s*%$/, ""))
            : "",
          totalAmount: item.totalAmount.trim()
            ? normalizeMoney(item.totalAmount)
            : "",
        };
      } catch {
        throw new Error(
          `Položka ${i + 1} obsahuje neplatné množství, cenu nebo sazbu DPH.`,
        );
      }
    }),
  };
  for (
    const [key, max] of [["variableSymbol", 10], ["constantSymbol", 4], [
      "specificSymbol",
      10,
    ]] as const
  ) {
    result[key] = data[key].trim();
    if (!new RegExp(`^\\d{0,${max}}$`).test(result[key])) {
      throw new Error(
        `${
          key === "variableSymbol"
            ? "Variabilní"
            : key === "constantSymbol"
            ? "Konstantní"
            : "Specifický"
        } symbol musí obsahovat nejvýše ${max} číslic.`,
      );
    }
  }
  result.iban = normalizeIban(data.iban);
  result.accountNumber = data.accountNumber.replace(/\s/g, "");
  if (result.iban && !isValidIban(result.iban)) {
    throw new Error("IBAN dodavatele není platný.");
  }
  if (result.accountNumber) {
    const match = /^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/.exec(
      result.accountNumber,
    );
    const iban = match
      ? czechAccountToIban(match[1] ?? "", match[2], match[3])
      : null;
    if (!iban) {
      throw new Error(
        "Účet dodavatele musí mít platný formát předčíslí-číslo/kód banky a kontrolní součet.",
      );
    }
    if (result.iban && result.iban !== iban) {
      throw new Error("Účet dodavatele a IBAN se neshodují.");
    }
    result.iban = iban;
  } else if (result.iban.startsWith("CZ")) {
    const local = czechAccountFromIban(result.iban);
    if (!local) {
      throw new Error("Český IBAN dodavatele obsahuje neplatný účet.");
    }
    result.accountNumber = `${
      local.accountPrefix ? local.accountPrefix + "-" : ""
    }${local.accountNumber}/${local.bankCode}`;
  }
  return result;
}
