import type { Contact, ContactFormInput } from "@/domain/contacts/types.ts";
const identity = (value: string | null) =>
  (value ?? "").replace(/\s/g, "").toUpperCase();
const nameKey = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("cs-CZ").replace(/[.,]/g, "")
    .replace(/\s+/g, " ").trim().replace(/\bs\s*r\s*o$/, "sro");

export function matchExpenseSupplier(
  supplier: ContactFormInput,
  contacts: Contact[],
): string | null {
  const active = contacts.filter((contact) => !contact.archivedAt);
  const compatible = active.filter((contact) =>
    !(["ico", "dic"] as const).some((key) =>
      identity(supplier[key]) && identity(contact[key]) &&
      identity(supplier[key]) !== identity(contact[key])
    )
  );
  const identifiers = compatible.filter((contact) =>
    (["ico", "dic"] as const).some((key) =>
      identity(supplier[key]) &&
      identity(supplier[key]) === identity(contact[key])
    )
  );
  if (identifiers.length) {
    return identifiers.length === 1 ? identifiers[0].id : null;
  }
  const names = compatible.filter((contact) =>
    nameKey(supplier.name) && nameKey(contact.name) === nameKey(supplier.name)
  );
  return names.length === 1 ? names[0].id : null;
}
