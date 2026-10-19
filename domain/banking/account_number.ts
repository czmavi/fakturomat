export function normalizeIban(value: string): string {
  return value.replaceAll(/\s+/g, "").toLocaleUpperCase("en-US");
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("CZ") && !/^CZ[0-9]{22}$/.test(iban)) return false;
  if (Number(iban.slice(2, 4)) < 2 || Number(iban.slice(2, 4)) > 98) {
    return false;
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const numeric = character >= "A"
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

// ČNB: each part is independently protected by weighted modulo 11.
export function hasValidAccountChecksum(value: string): boolean {
  if (!/^\d{1,10}$/.test(value)) return false;
  const weights = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];
  return [...value.padStart(10, "0")].reduce(
        (sum, digit, index) => sum + Number(digit) * weights[index],
        0,
      ) % 11 === 0;
}

export function isValidCzechAccount(
  prefix: string,
  number: string,
  bank: string,
): boolean {
  return /^\d{0,6}$/.test(prefix) && /^\d{1,10}$/.test(number) &&
    /[1-9]/.test(number) && /^\d{4}$/.test(bank) && bank !== "0000" &&
    (!prefix || hasValidAccountChecksum(prefix)) &&
    hasValidAccountChecksum(number);
}

export function czechAccountToIban(
  prefix: string,
  number: string,
  bank: string,
): string | null {
  if (!isValidCzechAccount(prefix, number, bank)) return null;
  const bban = bank + prefix.padStart(6, "0") + number.padStart(10, "0");
  const checksum = 98n - BigInt(`${bban}123500`) % 97n;
  return `CZ${String(checksum).padStart(2, "0")}${bban}`;
}

export function czechAccountFromIban(value: string): {
  accountPrefix: string;
  accountNumber: string;
  bankCode: string;
} | null {
  const iban = normalizeIban(value);
  if (!/^CZ\d{22}$/.test(iban) || !isValidIban(iban)) return null;
  const accountPrefix = iban.slice(8, 14).replace(/^0+/, "");
  const accountNumber = iban.slice(14).replace(/^0+/, "") || "0";
  const bankCode = iban.slice(4, 8);
  return isValidCzechAccount(accountPrefix, accountNumber, bankCode)
    ? { accountPrefix, accountNumber, bankCode }
    : null;
}
