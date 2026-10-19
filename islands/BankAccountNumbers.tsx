import { useState } from "preact/hooks";
import type { BankAccountInput } from "@/domain/banking/types.ts";
import {
  czechAccountFromIban,
  czechAccountToIban,
  isValidIban,
  normalizeIban,
} from "@/domain/banking/account_number.ts";

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";
type Numbers = Pick<
  BankAccountInput,
  "accountPrefix" | "accountNumber" | "bankCode" | "iban"
>;

export default function BankAccountNumbers({ values }: { values: Numbers }) {
  const [fields, setFields] = useState<Numbers>(values);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function change(key: keyof Numbers, value: string) {
    const next = { ...fields, [key]: value };
    setError("");
    setNotice("");
    if (key === "iban") {
      // An edited IBAN replaces the previous domestic identity, even while incomplete.
      next.accountPrefix = next.accountNumber = next.bankCode = "";
      const local = czechAccountFromIban(value);
      if (local) {
        Object.assign(next, local);
        setNotice("České číslo účtu bylo doplněno z IBANu.");
      } else if (isValidIban(value) && !normalizeIban(value).startsWith("CZ")) {
        setNotice("Zahraniční IBAN je platný; české číslo účtu se nevyplňuje.");
      }
    } else {
      const iban = czechAccountToIban(
        next.accountPrefix.trim(),
        next.accountNumber.trim(),
        next.bankCode.trim(),
      );
      next.iban = iban ?? "";
      if (iban) setNotice("IBAN byl automaticky doplněn.");
    }
    setFields(next);
  }

  function validate() {
    if (fields.iban) {
      if (
        !isValidIban(fields.iban) ||
        (normalizeIban(fields.iban).startsWith("CZ") &&
          !czechAccountFromIban(fields.iban))
      ) {
        setError("IBAN není platný. Zkontrolujte číslo a kontrolní součet.");
      }
    } else if (
      fields.accountNumber && fields.bankCode &&
      !czechAccountToIban(
        fields.accountPrefix.trim(),
        fields.accountNumber.trim(),
        fields.bankCode.trim(),
      )
    ) {
      setError(
        "Číslo účtu, předčíslí nebo kód banky nejsou platné. Zkontrolujte také kontrolní součet (modulo 11).",
      );
    }
  }

  return (
    <fieldset class="space-y-4" onBlur={validate}>
      <legend class="text-sm font-semibold">Číslo účtu a IBAN</legend>
      <p class="text-xs text-[#758078]">
        Vyplňte české číslo účtu s kódem banky nebo český IBAN. Druhý formát se
        automaticky doplní.
      </p>
      <div class="grid grid-cols-[0.8fr_1.4fr_0.8fr] gap-3">
        {([
          ["accountPrefix", "account_prefix", "Předčíslí", 6],
          ["accountNumber", "account_number", "Číslo účtu", 10],
          ["bankCode", "bank_code", "Kód banky", 4],
        ] as const).map(([key, name, label, max]) => (
          <label key={key}>
            <span class="mb-2 block text-xs text-[#667169]">{label}</span>
            <input
              name={name}
              inputmode="numeric"
              value={fields[key]}
              maxlength={max}
              class={inputClass}
              onInput={(event) => change(key, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      <label class="block">
        <span class="mb-2 block text-sm font-medium">IBAN</span>
        <input
          name="iban"
          value={fields.iban}
          maxlength={42}
          class={inputClass}
          placeholder="CZ52 2010 0000 0029 0000 0005"
          onInput={(event) => change("iban", event.currentTarget.value)}
        />
      </label>
      {error && <p role="alert" class="text-sm text-[#962f25]">{error}</p>}
      <p role="status" class="text-sm text-[#277a4c]">{notice}</p>
    </fieldset>
  );
}
