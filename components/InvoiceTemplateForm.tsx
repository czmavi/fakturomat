import type { InvoiceTemplateInput } from "@/domain/invoices/template_types.ts";
import { TEMPLATE_PLACEHOLDERS } from "@/domain/invoices/template_types.ts";

export interface InvoiceTemplateFormProps {
  values: InvoiceTemplateInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export const EMPTY_INVOICE_TEMPLATE: InvoiceTemplateInput = {
  name: "",
  description: "",
  html: `<main class="invoice">
  <h1>Faktura {{invoice.number}}</h1>
  <p>Dodavatel: {{supplier.name}}</p>
  <p>Odběratel: {{customer.name}}</p>
  <table>
    <tbody>{{invoice.items}}</tbody>
  </table>
  <strong>Celkem: {{invoice.total}} {{invoice.currency}}</strong>
  <div>{{payment.qr}}</div>
</main>`,
  css: `@page { size: A4; margin: 15mm; }
body { font-family: Arial, sans-serif; color: #18211c; }
.invoice { width: 100%; }
table { width: 100%; border-collapse: collapse; }`,
};

export function invoiceTemplateInputFromForm(
  form: FormData,
): InvoiceTemplateInput {
  return {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    html: String(form.get("html") ?? ""),
    css: String(form.get("css") ?? ""),
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function InvoiceTemplateForm(props: InvoiceTemplateFormProps) {
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
        <label>
          <span class="mb-2 block text-sm font-medium">Název</span>
          <input
            name="name"
            value={props.values.name}
            maxlength={120}
            required
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Popis</span>
          <input
            name="description"
            value={props.values.description}
            maxlength={500}
            class={inputClass}
          />
        </label>
      </div>
      <label class="block">
        <span class="mb-2 block text-sm font-medium">HTML</span>
        <textarea
          name="html"
          rows={20}
          maxlength={100000}
          required
          spellcheck={false}
          class={`${inputClass} font-mono text-xs leading-5`}
        >
          {props.values.html}
        </textarea>
      </label>
      <label class="block">
        <span class="mb-2 block text-sm font-medium">CSS</span>
        <textarea
          name="css"
          rows={16}
          maxlength={100000}
          spellcheck={false}
          class={`${inputClass} font-mono text-xs leading-5`}
        >
          {props.values.css}
        </textarea>
      </label>
      <details class="rounded-xl border border-[#dce2dc] bg-[#f7f9f7] p-4">
        <summary class="cursor-pointer text-sm font-semibold">
          Podporované placeholders
        </summary>
        <div class="mt-3 flex flex-wrap gap-2">
          {TEMPLATE_PLACEHOLDERS.map((placeholder) => (
            <code class="rounded bg-white px-2 py-1 text-xs text-[#3c4940]">
              {`{{${placeholder}}}`}
            </code>
          ))}
        </div>
      </details>
      <p class="text-sm text-[#667169]">
        Každé uložení existující šablony vytvoří novou neměnnou verzi.
        JavaScript a externí zdroje nejsou povolené.
      </p>
      <button
        type="submit"
        class="rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b] focus:outline-none focus:ring-3 focus:ring-[#b9ddc8]"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
