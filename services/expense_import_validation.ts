import {
  formatMoneyFromMinorUnits,
  normalizeMoney,
  normalizeQuantity,
  parseMoneyToMinorUnits,
} from "@/domain/invoices/money.ts";
import { normalizeVatRate } from "@/domain/expenses/vat.ts";
import type { ExpenseFormInput } from "@/domain/expenses/types.ts";

export function importReader(warnings: string[]) {
  return (
    raw: unknown,
    label: string,
    normalize: (value: string) => string = (v) => v,
    required = false,
  ): string => {
    try {
      if (raw === undefined || raw === "") {
        if (required) throw new Error();
        return "";
      }
      if (typeof raw !== "string") throw new Error();
      const value = raw.trim();
      if (!value && !required) return "";
      if (!value) throw new Error();
      return normalize(value);
    } catch {
      warnings.push(
        `${label}: údaj chybí nebo není platný; údaj nebyl doplněn.`,
      );
      return "";
    }
  };
}
export const textLength = (max: number, min = 0) => (value: string) => {
  if (value.length < min || value.length > max) throw new Error();
  return value;
};
export const pattern = (regex: RegExp) => (value: string) => {
  if (!regex.test(value)) throw new Error();
  return value;
};
const currencies = new Set(Intl.supportedValuesOf("currency"));

export function importCurrency(value: string): string {
  const code = value.normalize("NFKC").toUpperCase();
  if (["KČ", "KC", "KČ.", "KORUNA ČESKÁ"].includes(code)) return "CZK";
  if (code === "€") return "EUR";
  if (!currencies.has(code)) throw new Error();
  return code;
}
export function importDate(value: string): string {
  pattern(/^\d{4}-\d{2}-\d{2}$/)(value);
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
  ) throw new Error();
  return value;
}
export const importMoney = (value: string) =>
  normalizeMoney(value.replace(/[\s\u00a0\u202f]/g, ""));
export const importQuantity = (value: string) => normalizeQuantity(value);
export const importVatRate = (value: string) =>
  normalizeVatRate(value.replace(/\s*%$/, ""));
export const importObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export interface ItemTotalCheck {
  status: "match" | "mismatch" | "unavailable";
  message: string;
}
export function parseImportedRounding(raw: unknown): bigint {
  if (typeof raw !== "string") throw new Error();
  const amount = raw.trim();
  const result =
    parseMoneyToMinorUnits(importMoney(amount.replace(/^[+-]/, ""))) *
    (amount.startsWith("-") ? -1n : 1n);
  if (result <= -100n || result >= 100n) throw new Error();
  return result;
}

/** Compare integer minor units, excluding only explicitly extracted rounding. */
export function checkImportedItemTotal(
  values: ExpenseFormInput,
  rounding: unknown,
  incomplete = false,
): ItemTotalCheck {
  const items = values.details?.items ?? [];
  const unavailable = (reason: string): ItemTotalCheck => ({
    status: "unavailable",
    message: `Součet položek nelze ověřit: ${reason}`,
  });
  if (incomplete || !items.length || items.some((item) => !item.totalAmount)) {
    return unavailable(
      "některé položky nebo jejich ceny včetně DPH chybí. Zkontrolujte všechny strany dokladu.",
    );
  }
  if (!values.totalAmount) {
    return unavailable("celková cena dokladu chybí nebo není platná.");
  }
  let adjustment = 0n;
  if (rounding !== undefined && rounding !== "") {
    try {
      adjustment = parseImportedRounding(rounding);
    } catch {
      return unavailable(
        "haléřové vyrovnání není platné (musí být menší než jedna jednotka měny).",
      );
    }
  }
  const sum = items.reduce(
    (total, item) => total + parseMoneyToMinorUnits(item.totalAmount),
    0n,
  );
  const expected = parseMoneyToMinorUnits(values.totalAmount) - adjustment;
  const difference = sum - expected;
  const money = (value: bigint) =>
    `${value < 0n ? "−" : ""}${
      formatMoneyFromMinorUnits(value < 0n ? -value : value).replace(".", ",")
    }`;
  const comparison = `Součet položek včetně DPH ${
    money(sum)
  }; celková cena bez haléřového vyrovnání ${money(expected)}${
    values.currency ? ` ${values.currency}` : ""
  }.`;
  return difference === 0n
    ? { status: "match", message: `Součet položek souhlasí. ${comparison}` }
    : {
      status: "mismatch",
      message: `Součet položek nesouhlasí. ${comparison} Rozdíl ${
        money(difference)
      }. Zkontrolujte položky a celkovou cenu podle dokladu.`,
    };
}
