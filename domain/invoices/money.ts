const MONEY_PATTERN = /^(0|[1-9][0-9]{0,15})(?:[.,]([0-9]{1,2}))?$/;
const QUANTITY_PATTERN = /^(0|[1-9][0-9]{0,13})(?:[.,]([0-9]{1,4}))?$/;

export class DecimalValidationError extends Error {}

function parseScaled(
  value: string,
  scale: number,
  pattern: RegExp,
  label: string,
): bigint {
  const normalized = value.trim();
  const match = pattern.exec(normalized);
  if (!match) {
    throw new DecimalValidationError(`${label} nemá platný formát.`);
  }
  const fraction = (match[2] ?? "").padEnd(scale, "0");
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(fraction || "0");
}

function formatScaled(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(scale, "0");
  return `${whole}.${fraction}`;
}

export function parseMoneyToMinorUnits(value: string): bigint {
  return parseScaled(value, 2, MONEY_PATTERN, "Částka");
}

export function formatMoneyFromMinorUnits(value: bigint): string {
  return formatScaled(value, 2);
}

export function normalizeMoney(value: string): string {
  return formatMoneyFromMinorUnits(parseMoneyToMinorUnits(value));
}

export function parseQuantityToUnits(value: string): bigint {
  return parseScaled(value, 4, QUANTITY_PATTERN, "Množství");
}

export function normalizeQuantity(value: string): string {
  const units = parseQuantityToUnits(value);
  const formatted = formatScaled(units, 4);
  return formatted.replace(/0+$/, "").replace(/\.$/, "");
}

export function multiplyMoneyByQuantity(
  moneyMinorUnits: bigint,
  quantityUnits: bigint,
): bigint {
  const product = moneyMinorUnits * quantityUnits;
  const scale = 10_000n;
  return (product + scale / 2n) / scale;
}

export function formatMoneyForDisplay(value: string): string {
  const normalized = normalizeMoney(value);
  const [whole, fraction] = normalized.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${fraction}`;
}
