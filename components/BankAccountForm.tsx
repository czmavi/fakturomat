import type { BankAccountInput } from "@/domain/banking/types.ts";

export interface BankAccountFormProps {
  values: BankAccountInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export const EMPTY_BANK_ACCOUNT: BankAccountInput = {
  name: "",
  bankName: "",
  accountPrefix: "",
  accountNumber: "",
  bankCode: "",
  iban: "",
  bic: "",
  currency: "CZK",
  isDefault: false,
  isActive: true,
};

export function bankAccountInputFromForm(form: FormData): BankAccountInput {
  return {
    name: String(form.get("name") ?? ""),
    bankName: String(form.get("bank_name") ?? ""),
    accountPrefix: String(form.get("account_prefix") ?? ""),
    accountNumber: String(form.get("account_number") ?? ""),
    bankCode: String(form.get("bank_code") ?? ""),
    iban: String(form.get("iban") ?? ""),
    bic: String(form.get("bic") ?? ""),
    currency: String(form.get("currency") ?? ""),
    isDefault: form.has("is_default"),
    isActive: form.has("is_active"),
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function BankAccountForm(props: BankAccountFormProps) {
  return (
    <form method="post" class="mt-7 space-y-6">
      <input type="hidden" name="csrf_token" value={props.csrfToken} />
      {props.error && (
        <div
          role="alert"
          class="rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
        >
          {props.error}
        </div>
      )}

      <div class="grid gap-5 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Název účtu</span>
          <input
            name="name"
            value={props.values.name}
            maxlength={100}
            required
            class={inputClass}
            placeholder="Hlavní účet"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Banka</span>
          <input
            name="bank_name"
            value={props.values.bankName}
            maxlength={120}
            class={inputClass}
            placeholder="Fio banka"
          />
        </label>
      </div>

      <fieldset>
        <legend class="text-sm font-semibold">České číslo účtu</legend>
        <p class="mt-1 text-xs text-[#758078]">
          Vyplňte české číslo účtu, IBAN, nebo obojí.
        </p>
        <div class="mt-4 grid grid-cols-[0.8fr_1.4fr_0.8fr] gap-3">
          <label>
            <span class="mb-2 block text-xs text-[#667169]">Předčíslí</span>
            <input
              name="account_prefix"
              inputmode="numeric"
              value={props.values.accountPrefix}
              maxlength={6}
              class={inputClass}
            />
          </label>
          <label>
            <span class="mb-2 block text-xs text-[#667169]">Číslo účtu</span>
            <input
              name="account_number"
              inputmode="numeric"
              value={props.values.accountNumber}
              maxlength={10}
              class={inputClass}
            />
          </label>
          <label>
            <span class="mb-2 block text-xs text-[#667169]">Kód banky</span>
            <input
              name="bank_code"
              inputmode="numeric"
              value={props.values.bankCode}
              maxlength={4}
              class={inputClass}
            />
          </label>
        </div>
      </fieldset>

      <div class="grid gap-5 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">IBAN</span>
          <input
            name="iban"
            value={props.values.iban}
            maxlength={42}
            class={inputClass}
            placeholder="CZ63 2010 0000 0029 0000 0001"
          />
        </label>
        <label class="block">
          <span class="mb-2 block text-sm font-medium">BIC / SWIFT</span>
          <input
            name="bic"
            value={props.values.bic}
            maxlength={11}
            class={inputClass}
            placeholder="FIOBCZPPXXX"
          />
        </label>
        <label class="block">
          <span class="mb-2 block text-sm font-medium">Měna</span>
          <input
            name="currency"
            value={props.values.currency}
            maxlength={3}
            required
            class={inputClass}
          />
        </label>
      </div>

      <div class="flex flex-wrap gap-5 rounded-xl bg-[#f5f7f5] px-4 py-4">
        <label class="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="is_active"
            checked={props.values.isActive}
            class="size-4 accent-[#277a4c]"
          />
          Aktivní účet
        </label>
        <label class="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="is_default"
            checked={props.values.isDefault}
            class="size-4 accent-[#277a4c]"
          />
          Výchozí pro faktury
        </label>
      </div>

      <button
        type="submit"
        class="w-full rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b] focus:outline-none focus:ring-3 focus:ring-[#b9ddc8]"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
