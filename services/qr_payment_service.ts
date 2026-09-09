import QRCode from "qrcode";
import type { BankAccountSnapshot } from "@/domain/invoices/types.ts";
import {
  normalizeMoney,
  parseMoneyToMinorUnits,
} from "@/domain/invoices/money.ts";
import { isValidIban, normalizeIban } from "@/services/bank_account_service.ts";

export interface QrPaymentInput {
  bankAccount: BankAccountSnapshot;
  amount: string;
  currency: string;
  variableSymbol: string | null;
  dueDate: string;
  message: string;
}

export class QrPaymentValidationError extends Error {}

const MAX_SPAYD_AMOUNT_MINOR_UNITS = 999_999_999n;

function modulo97(value: string): number {
  let remainder = 0;
  for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

export function createCzechIban(input: {
  accountPrefix: string | null;
  accountNumber: string;
  bankCode: string;
}): string {
  if (
    !/^[0-9]{1,10}$/.test(input.accountNumber) ||
    !/^[0-9]{4}$/.test(input.bankCode) ||
    (input.accountPrefix !== null && !/^[0-9]{1,6}$/.test(input.accountPrefix))
  ) {
    throw new QrPaymentValidationError(
      "České číslo účtu nelze převést na IBAN.",
    );
  }
  const bban = input.bankCode + (input.accountPrefix ?? "").padStart(6, "0") +
    input.accountNumber.padStart(10, "0");
  const checkDigits = String(98 - modulo97(`${bban}123500`)).padStart(2, "0");
  const iban = `CZ${checkDigits}${bban}`;
  if (!isValidIban(iban)) {
    throw new QrPaymentValidationError(
      "Odvozený IBAN nemá platný kontrolní součet.",
    );
  }
  return iban;
}

export function resolvePaymentIban(account: BankAccountSnapshot): string {
  if (account.iban) {
    const iban = normalizeIban(account.iban);
    if (!isValidIban(iban)) {
      throw new QrPaymentValidationError("IBAN platebního účtu není platný.");
    }
    return iban;
  }
  if (!account.accountNumber || !account.bankCode) {
    throw new QrPaymentValidationError(
      "Platební účet nemá IBAN ani úplné české číslo účtu.",
    );
  }
  return createCzechIban({
    accountPrefix: account.accountPrefix,
    accountNumber: account.accountNumber,
    bankCode: account.bankCode,
  });
}

export function normalizeSpaydMessage(value: string): string {
  return value.normalize("NFD").replaceAll(/\p{M}/gu, "")
    .toLocaleUpperCase("cs-CZ")
    .replaceAll("*", " ")
    .replaceAll(/[^A-Z0-9 $%+\-./:]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trimEnd();
}

export function createSpaydPayload(input: QrPaymentInput): string {
  const iban = resolvePaymentIban(input.bankAccount);
  let amountMinorUnits: bigint;
  let amount: string;
  try {
    amountMinorUnits = parseMoneyToMinorUnits(input.amount);
    amount = normalizeMoney(input.amount);
  } catch {
    throw new QrPaymentValidationError("Částka QR Platby nemá platný formát.");
  }
  if (
    amountMinorUnits <= 0n || amountMinorUnits > MAX_SPAYD_AMOUNT_MINOR_UNITS
  ) {
    throw new QrPaymentValidationError(
      "Částka QR Platby musí být od 0,01 do 9 999 999,99.",
    );
  }
  const currency = input.currency.trim().toLocaleUpperCase("en-US");
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new QrPaymentValidationError("Měna QR Platby nemá platný formát.");
  }
  if (!isIsoDate(input.dueDate)) {
    throw new QrPaymentValidationError(
      "Datum splatnosti QR Platby není platné.",
    );
  }
  const dueDate = input.dueDate.replaceAll("-", "");
  const variableSymbol = input.variableSymbol?.trim() || null;
  if (variableSymbol && !/^[0-9]{1,10}$/.test(variableSymbol)) {
    throw new QrPaymentValidationError(
      "Variabilní symbol QR Platby není platný.",
    );
  }
  const message = normalizeSpaydMessage(input.message);
  const bic = input.bankAccount.bic?.trim().toLocaleUpperCase("en-US") || null;
  if (bic && !/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/.test(bic)) {
    throw new QrPaymentValidationError("BIC platebního účtu není platný.");
  }
  const account = bic ? `${iban}+${bic}` : iban;
  const fields: Array<[string, string]> = [
    ["ACC", account],
    ["AM", amount],
    ["CC", currency],
    ["DT", dueDate],
  ];
  if (message) fields.push(["MSG", message]);
  if (variableSymbol) fields.push(["X-VS", variableSymbol]);
  fields.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `SPD*1.0*${fields.map(([key, value]) => `${key}:${value}`).join("*")}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

export async function generateQrPaymentSvg(
  input: QrPaymentInput,
): Promise<string> {
  return await QRCode.toString(createSpaydPayload(input), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 256,
    color: { dark: "#18211cff", light: "#ffffffff" },
  });
}
