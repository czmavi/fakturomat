import type { BankAccount } from "@/domain/banking/types.ts";
import { formatBankAccount } from "@/domain/banking/types.ts";
import type { Contact } from "@/domain/contacts/types.ts";
import type { InvoiceTemplate } from "@/domain/invoices/template_types.ts";
import type {
  Invoice,
  InvoiceDraftFormInput,
} from "@/domain/invoices/types.ts";
import type { InvoiceNumberSequence } from "@/domain/invoices/number_sequence_types.ts";
import InvoiceItemsEditor from "@/islands/InvoiceItemsEditor.tsx";

export interface InvoiceFormOptions {
  contacts: Contact[];
  numberSequences: InvoiceNumberSequence[];
  bankAccounts: BankAccount[];
  templates: InvoiceTemplate[];
}

export interface InvoiceFormProps extends InvoiceFormOptions {
  values: InvoiceDraftFormInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export function invoiceDraftInputFromForm(
  form: FormData,
): InvoiceDraftFormInput {
  const descriptions = form.getAll("item_description");
  const quantities = form.getAll("item_quantity");
  const units = form.getAll("item_unit");
  const prices = form.getAll("item_unit_price");
  const length = Math.max(
    descriptions.length,
    quantities.length,
    units.length,
    prices.length,
  );
  return {
    contactId: String(form.get("contact_id") ?? ""),
    numberSequenceId: String(form.get("number_sequence_id") ?? ""),
    bankAccountId: String(form.get("bank_account_id") ?? ""),
    invoiceTemplateId: String(form.get("invoice_template_id") ?? ""),
    variableSymbol: String(form.get("variable_symbol") ?? ""),
    issueDate: String(form.get("issue_date") ?? ""),
    dueDate: String(form.get("due_date") ?? ""),
    currency: String(form.get("currency") ?? ""),
    note: String(form.get("note") ?? ""),
    items: Array.from({ length }, (_, index) => ({
      description: String(descriptions[index] ?? ""),
      quantity: String(quantities[index] ?? ""),
      unit: String(units[index] ?? ""),
      unitPrice: String(prices[index] ?? ""),
    })),
  };
}

export function invoiceDraftInputFromInvoice(
  invoice: Invoice,
): InvoiceDraftFormInput {
  return {
    contactId: invoice.contactId,
    numberSequenceId: invoice.numberSequenceId,
    bankAccountId: invoice.bankAccountId ?? "",
    invoiceTemplateId: invoice.invoiceTemplateId,
    variableSymbol: invoice.variableSymbol ?? "",
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    note: invoice.note ?? "",
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
    })),
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function InvoiceForm(props: InvoiceFormProps) {
  return (
    <form method="post" class="mt-7 space-y-8">
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
          <span class="mb-2 block text-sm font-medium">Odběratel</span>
          <select name="contact_id" class={inputClass} required>
            <option value="">Vyberte kontakt</option>
            {props.contacts.map((contact) => (
              <option
                value={contact.id}
                selected={props.values.contactId === contact.id}
              >
                {contact.name}
                {contact.archivedAt ? " · archivovaný" : ""}
              </option>
            ))}
          </select>
          {props.contacts.length === 0 && (
            <span class="mt-2 block text-xs text-[#962f25]">
              Nejdříve vytvořte alespoň jeden kontakt.
            </span>
          )}
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Datum vystavení</span>
          <input
            type="date"
            name="issue_date"
            value={props.values.issueDate}
            required
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Datum splatnosti</span>
          <input
            type="date"
            name="due_date"
            value={props.values.dueDate}
            required
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Měna</span>
          <input
            name="currency"
            value={props.values.currency}
            maxlength={3}
            required
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Variabilní symbol</span>
          <input
            name="variable_symbol"
            value={props.values.variableSymbol}
            maxlength={10}
            inputmode="numeric"
            class={inputClass}
            placeholder="Doplní se při vystavení"
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Číselná řada</span>
          <select name="number_sequence_id" class={inputClass} required>
            {props.numberSequences.map((sequence) => (
              <option
                value={sequence.id}
                selected={props.values.numberSequenceId === sequence.id}
              >
                {sequence.name}
                {sequence.isActive ? "" : " · neaktivní"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Bankovní účet</span>
          <select name="bank_account_id" class={inputClass}>
            <option value="">Bez bankovního účtu</option>
            {props.bankAccounts.map((account) => (
              <option
                value={account.id}
                selected={props.values.bankAccountId === account.id}
              >
                {account.name} · {formatBankAccount(account)}
                {account.isActive ? "" : " · neaktivní"}
              </option>
            ))}
          </select>
        </label>
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Šablona</span>
          <select name="invoice_template_id" class={inputClass} required>
            {props.templates.map((template) => (
              <option
                value={template.id}
                selected={props.values.invoiceTemplateId === template.id}
              >
                {template.name} · aktuálně v{template.currentVersion}
                {template.isActive ? "" : " · neaktivní"}
              </option>
            ))}
          </select>
          <span class="mt-2 block text-xs text-[#758078]">
            Konkrétní verze šablony se uzamkne až při vystavení.
          </span>
        </label>
      </div>

      <InvoiceItemsEditor
        initialItems={props.values.items}
        currency={props.values.currency}
      />

      <label class="block">
        <span class="mb-2 block text-sm font-medium">Poznámka na faktuře</span>
        <textarea name="note" maxlength={2000} rows={4} class={inputClass}>
          {props.values.note}
        </textarea>
      </label>
      <button
        type="submit"
        disabled={props.contacts.length === 0 ||
          props.numberSequences.length === 0 || props.templates.length === 0}
        class="w-full rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
