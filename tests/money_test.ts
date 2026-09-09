import {
  DecimalValidationError,
  formatMoneyForDisplay,
  formatMoneyFromMinorUnits,
  multiplyMoneyByQuantity,
  normalizeMoney,
  normalizeQuantity,
  parseMoneyToMinorUnits,
  parseQuantityToUnits,
} from "@/domain/invoices/money.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("money uses exact minor units without floating point", () => {
  assert(parseMoneyToMinorUnits("19,99") === 1999n, "comma amount failed");
  assert(normalizeMoney("19.9") === "19.90", "money normalization failed");
  assert(
    normalizeQuantity("1.5000") === "1.5",
    "quantity normalization failed",
  );
  const total = multiplyMoneyByQuantity(
    parseMoneyToMinorUnits("19.99"),
    parseQuantityToUnits("3"),
  );
  assert(
    formatMoneyFromMinorUnits(total) === "59.97",
    "exact multiplication failed",
  );
  assert(
    formatMoneyForDisplay("1234567.80") === "1 234 567,80",
    "display formatting failed",
  );
});

Deno.test("money rejects excess precision and negative values", () => {
  for (const value of ["1.001", "-1", "1e3", "NaN"]) {
    let rejected = false;
    try {
      parseMoneyToMinorUnits(value);
    } catch (error) {
      rejected = error instanceof DecimalValidationError;
    }
    assert(rejected, `invalid money value ${value} was accepted`);
  }
});
