import type {
  InvoiceNumberSequenceInput,
} from "@/domain/invoices/number_sequence_types.ts";

export interface InvoiceNumberSequenceFormProps {
  values: InvoiceNumberSequenceInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export const EMPTY_INVOICE_NUMBER_SEQUENCE: InvoiceNumberSequenceInput = {
  name: "",
  prefix: "",
  padding: "4",
  isDefault: false,
  isActive: true,
};

export function invoiceNumberSequenceInputFromForm(
  form: FormData,
): InvoiceNumberSequenceInput {
  return {
    name: String(form.get("name") ?? ""),
    prefix: String(form.get("prefix") ?? ""),
    padding: String(form.get("padding") ?? ""),
    isDefault: form.has("is_default"),
    isActive: form.has("is_active"),
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function InvoiceNumberSequenceForm(
  props: InvoiceNumberSequenceFormProps,
) {
  const year = new Date().getFullYear();
  const preview = `${
    props.values.prefix.trim().toLocaleUpperCase("en-US")
  }${year}-${"1".padStart(Number(props.values.padding) || 4, "0")}`;
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
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Název řady</span>
          <input
            name="name"
            value={props.values.name}
            maxlength={100}
            required
            class={inputClass}
            placeholder="Výchozí"
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Prefix</span>
          <input
            name="prefix"
            value={props.values.prefix}
            maxlength={20}
            class={inputClass}
            placeholder="SD-"
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">
            Číslic pořadí
          </span>
          <input
            type="number"
            name="padding"
            value={props.values.padding}
            min={1}
            max={9}
            required
            class={inputClass}
          />
        </label>
      </div>
      <div class="rounded-xl bg-[#f3f6f3] px-4 py-3 text-sm text-[#59645c]">
        Ukázka prvního čísla v roce {year}: <strong>{preview}</strong>
      </div>
      <div class="flex flex-wrap gap-5 rounded-xl bg-[#f5f7f5] px-4 py-4">
        <label class="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="is_active"
            checked={props.values.isActive}
            class="size-4 accent-[#277a4c]"
          />
          Aktivní řada
        </label>
        <label class="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="is_default"
            checked={props.values.isDefault}
            class="size-4 accent-[#277a4c]"
          />
          Výchozí pro nové faktury
        </label>
      </div>
      <button
        type="submit"
        class="w-full rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b]"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
