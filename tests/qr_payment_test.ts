import type { BankAccountSnapshot } from "@/domain/invoices/types.ts";
import {
  createCzechIban,
  createSpaydPayload,
  generateQrPaymentSvg,
  normalizeSpaydMessage,
  QrPaymentValidationError,
} from "@/services/qr_payment_service.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const bankAccount: BankAccountSnapshot = {
  name: "Fio účet",
  bankName: "Fio banka",
  accountPrefix: null,
  accountNumber: "2900000001",
  bankCode: "2010",
  iban: null,
  bic: "FIOBCZPPXXX",
  currency: "CZK",
};

const payment = {
  bankAccount,
  amount: "18500",
  currency: "czk",
  variableSymbol: "20260001",
  dueDate: "2026-09-22",
  message: "Faktura 2026-0001",
};

function assertQrValidationError(run: () => unknown): void {
  let rejected = false;
  try {
    run();
  } catch (error) {
    rejected = error instanceof QrPaymentValidationError;
  }
  assert(rejected, "invalid QR payment input was accepted");
}

Deno.test("QR payment derives a valid Czech IBAN", () => {
  assert(
    createCzechIban({
      accountPrefix: bankAccount.accountPrefix,
      accountNumber: "2900000001",
      bankCode: "2010",
    }) === "CZ6320100000002900000001",
    "Czech IBAN was derived incorrectly",
  );
});

Deno.test("QR payment creates a canonical ordered SPAYD payload", () => {
  assert(
    createSpaydPayload(payment) ===
      "SPD*1.0*ACC:CZ6320100000002900000001+FIOBCZPPXXX*AM:18500.00*CC:CZK*DT:20260922*MSG:FAKTURA 2026-0001*X-VS:20260001",
    "SPAYD payload is not canonical",
  );
  assert(
    normalizeSpaydMessage("  Úhrada * za číslo 42  ") ===
      "UHRADA ZA CISLO 42",
    "SPAYD message was not normalized",
  );
});

Deno.test("QR payment rejects invalid payment details", () => {
  assertQrValidationError(() =>
    createSpaydPayload({ ...payment, amount: "10000000.00" })
  );
  assertQrValidationError(() =>
    createSpaydPayload({ ...payment, dueDate: "2026-02-30" })
  );
  assertQrValidationError(() =>
    createSpaydPayload({ ...payment, variableSymbol: "2026-1" })
  );
  assertQrValidationError(() =>
    createSpaydPayload({
      ...payment,
      bankAccount: {
        ...bankAccount,
        accountNumber: null,
        bankCode: null,
      },
    })
  );
});

Deno.test("QR payment is rendered locally as safe SVG", async () => {
  const svg = await generateQrPaymentSvg(payment);
  assert(svg.startsWith("<svg"), "QR output is not SVG");
  assert(svg.includes("<path"), "QR SVG has no path data");
  assert(!/<script|foreignObject|onload=/i.test(svg), "QR SVG is unsafe");
});
