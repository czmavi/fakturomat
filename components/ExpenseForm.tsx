import type { Contact } from "@/domain/contacts/types.ts";
import {
  type Expense,
  type ExpenseCategory,
  type ExpenseFormInput,
} from "@/domain/expenses/types.ts";
import ExpenseVatLinesEditor from "@/islands/ExpenseVatLinesEditor.tsx";

export interface ExpenseFormOptions {
  contacts: Contact[];
  categories: ExpenseCategory[];
}

export interface ExpenseFormProps extends ExpenseFormOptions {
  values: ExpenseFormInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export function expenseInputFromForm(form: FormData): ExpenseFormInput {
  const value = (name: string) => String(form.get(name) ?? "");
  const vatRates = form.getAll("vat_rate");
  const vatBases = form.getAll("vat_base_amount");
  const vatAmounts = form.getAll("vat_amount");
  const vatLineCount = Math.max(
    vatRates.length,
    vatBases.length,
    vatAmounts.length,
  );
  return {
    contactId: value("contact_id"),
    documentType: value("document_type"),
    supplierName: value("supplier_name"),
    supplierInvoiceNumber: value("supplier_invoice_number"),
    issueDate: value("issue_date"),
    taxableSupplyDate: value("taxable_supply_date"),
    dueDate: value("due_date"),
    paymentDate: value("payment_date"),
    description: value("description"),
    categoryId: value("category_id"),
    currency: value("currency"),
    totalAmount: value("total_amount"),
    note: value("note"),
    vatLines: Array.from({ length: vatLineCount }, (_, index) => ({
      vatRate: String(vatRates[index] ?? ""),
      baseAmount: String(vatBases[index] ?? ""),
      vatAmount: String(vatAmounts[index] ?? ""),
    })),
  };
}

export function expenseInputFromExpense(expense: Expense): ExpenseFormInput {
  return {
    contactId: expense.contactId ?? "",
    documentType: expense.documentType,
    supplierName: expense.supplierName,
    supplierInvoiceNumber: expense.supplierInvoiceNumber ?? "",
    issueDate: expense.issueDate ?? "",
    taxableSupplyDate: expense.taxableSupplyDate ?? "",
    dueDate: expense.dueDate ?? "",
    paymentDate: expense.paymentDate ?? "",
    description: expense.description,
    categoryId: expense.categoryId ?? "",
    currency: expense.currency,
    totalAmount: expense.totalAmount,
    note: expense.note ?? "",
    vatLines: expense.vatLines.map((line) => ({
      vatRate: line.vatRate,
      baseAmount: line.baseAmount,
      vatAmount: line.vatAmount,
    })),
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function ExpenseForm(props: ExpenseFormProps) {
  return (
    <form method="post" class="mt-7 space-y-7">
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
          <span class="mb-2 block text-sm font-medium">Typ dokladu</span>
          <select name="document_type" class={inputClass} required>
            <option
              value="INVOICE"
              selected={props.values.documentType === "INVOICE"}
            >
              Přijatá faktura
            </option>
            <option
              value="RECEIPT"
              selected={props.values.documentType === "RECEIPT"}
            >
              Účtenka
            </option>
            <option
              value="OTHER"
              selected={props.values.documentType === "OTHER"}
            >
              Ostatní náklad
            </option>
          </select>
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Kategorie</span>
          <select name="category_id" class={inputClass}>
            <option value="">Bez kategorie</option>
            {props.categories.map((category) => (
              <option
                value={category.id}
                selected={props.values.categoryId === category.id}
              >
                {category.name}
                {category.isActive ? "" : " · neaktivní"}
              </option>
            ))}
          </select>
        </label>
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Dodavatel</span>
          <input
            name="supplier_name"
            value={props.values.supplierName}
            maxlength={200}
            required
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">
            Kontakt v adresáři
          </span>
          <select name="contact_id" class={inputClass}>
            <option value="">Bez vazby na kontakt</option>
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
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Číslo dokladu</span>
          <input
            name="supplier_invoice_number"
            value={props.values.supplierInvoiceNumber}
            maxlength={100}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Datum vystavení</span>
          <input
            type="date"
            name="issue_date"
            value={props.values.issueDate}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Datum plnění</span>
          <input
            type="date"
            name="taxable_supply_date"
            value={props.values.taxableSupplyDate}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Datum splatnosti</span>
          <input
            type="date"
            name="due_date"
            value={props.values.dueDate}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Datum úhrady</span>
          <input
            type="date"
            name="payment_date"
            value={props.values.paymentDate}
            class={inputClass}
          />
        </label>
        <label class="sm:col-span-2 sm:max-w-xs">
          <span class="mb-2 block text-sm font-medium">Měna</span>
          <input
            name="currency"
            value={props.values.currency}
            maxlength={3}
            required
            class={inputClass}
          />
        </label>
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Popis nákladu</span>
          <textarea
            name="description"
            maxlength={1000}
            rows={3}
            required
            class={inputClass}
          >
            {props.values.description}
          </textarea>
        </label>
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Poznámka</span>
          <textarea name="note" maxlength={5000} rows={4} class={inputClass}>
            {props.values.note}
          </textarea>
        </label>
      </div>

      <ExpenseVatLinesEditor
        initialLines={props.values.vatLines}
        initialTotalAmount={props.values.totalAmount}
        currency={props.values.currency}
      />

      <button
        type="submit"
        class="w-full rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b]"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
