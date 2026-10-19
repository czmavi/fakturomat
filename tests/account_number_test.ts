import {
  czechAccountFromIban,
  czechAccountToIban,
  hasValidAccountChecksum,
  isValidIban,
} from "@/domain/banking/account_number.ts";
function assert(value: boolean) {
  if (!value) throw new Error("Assertion failed");
}

Deno.test("Czech account conversion round trips known IBAN with prefix", () => {
  assert(
    czechAccountToIban("19", "2000145399", "0800") ===
      "CZ6508000000192000145399",
  );
  const local = czechAccountFromIban("cz65 0800 0000 1920 0014 5399");
  assert(
    local?.accountPrefix === "19" && local.accountNumber === "2000145399" &&
      local.bankCode === "0800",
  );
  assert(
    czechAccountToIban("000019", "2000145399", "0800") ===
      "CZ6508000000192000145399",
  );
  assert(hasValidAccountChecksum("19") && !hasValidAccountChecksum("18"));
});

Deno.test("conversion rejects wrong local checksums even with a valid IBAN mod97", () => {
  const bban = "08000000000000000001";
  const iban = `CZ${
    String(98n - BigInt(bban + "123500") % 97n).padStart(2, "0")
  }${bban}`;
  assert(isValidIban(iban));
  assert(czechAccountFromIban(iban) === null);
  assert(czechAccountToIban("", "1", "0800") === null);
  assert(czechAccountFromIban("DE89370400440532013000") === null);
  assert(!isValidIban("CZ650800000019200014539"));
});
