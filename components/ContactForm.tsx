import type { Contact, ContactFormInput } from "@/domain/contacts/types.ts";

export interface ContactFormProps {
  values: ContactFormInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export const EMPTY_CONTACT: ContactFormInput = {
  type: "COMPANY",
  name: "",
  ico: "",
  dic: "",
  street: "",
  city: "",
  postalCode: "",
  country: "CZ",
  email: "",
  phone: "",
  defaultDueDays: "",
  note: "",
};

export function contactInputFromForm(form: FormData): ContactFormInput {
  const value = (name: string) => String(form.get(name) ?? "");
  return {
    type: value("type"),
    name: value("name"),
    ico: value("ico"),
    dic: value("dic"),
    street: value("street"),
    city: value("city"),
    postalCode: value("postal_code"),
    country: value("country"),
    email: value("email"),
    phone: value("phone"),
    defaultDueDays: value("default_due_days"),
    note: value("note"),
  };
}

export function contactInputFromContact(contact: Contact): ContactFormInput {
  return {
    type: contact.type,
    name: contact.name,
    ico: contact.ico ?? "",
    dic: contact.dic ?? "",
    street: contact.street ?? "",
    city: contact.city ?? "",
    postalCode: contact.postalCode ?? "",
    country: contact.country,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    defaultDueDays: contact.defaultDueDays === null
      ? ""
      : String(contact.defaultDueDays),
    note: contact.note ?? "",
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function ContactForm(props: ContactFormProps) {
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
          <span class="mb-2 block text-sm font-medium">Typ kontaktu</span>
          <select name="type" class={inputClass}>
            <option value="COMPANY" selected={props.values.type === "COMPANY"}>
              Firma
            </option>
            <option value="PERSON" selected={props.values.type === "PERSON"}>
              Osoba
            </option>
          </select>
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Název / jméno</span>
          <input
            name="name"
            value={props.values.name}
            maxlength={200}
            required
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">IČO</span>
          <input
            name="ico"
            value={props.values.ico}
            maxlength={8}
            inputmode="numeric"
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">DIČ</span>
          <input
            name="dic"
            value={props.values.dic}
            maxlength={20}
            class={inputClass}
          />
        </label>
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Ulice a číslo</span>
          <input
            name="street"
            value={props.values.street}
            maxlength={200}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Město</span>
          <input
            name="city"
            value={props.values.city}
            maxlength={120}
            class={inputClass}
          />
        </label>
        <div class="grid grid-cols-[1fr_90px] gap-3">
          <label>
            <span class="mb-2 block text-sm font-medium">PSČ</span>
            <input
              name="postal_code"
              value={props.values.postalCode}
              maxlength={20}
              class={inputClass}
            />
          </label>
          <label>
            <span class="mb-2 block text-sm font-medium">Země</span>
            <input
              name="country"
              value={props.values.country}
              maxlength={2}
              required
              class={inputClass}
            />
          </label>
        </div>
        <label>
          <span class="mb-2 block text-sm font-medium">E-mail</span>
          <input
            type="email"
            name="email"
            value={props.values.email}
            maxlength={254}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Telefon</span>
          <input
            name="phone"
            value={props.values.phone}
            maxlength={60}
            class={inputClass}
          />
        </label>
        <label>
          <span class="mb-2 block text-sm font-medium">Výchozí splatnost</span>
          <input
            type="number"
            name="default_due_days"
            value={props.values.defaultDueDays}
            min={0}
            max={365}
            class={inputClass}
            placeholder="Podle subjektu"
          />
        </label>
        <label class="sm:col-span-2">
          <span class="mb-2 block text-sm font-medium">Poznámka</span>
          <textarea name="note" maxlength={5000} rows={4} class={inputClass}>
            {props.values.note}
          </textarea>
        </label>
      </div>
      <button
        type="submit"
        class="rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b] focus:outline-none focus:ring-3 focus:ring-[#b9ddc8]"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
