import {
  type Contact,
  type ContactFormInput,
  isContactType,
  type NormalizedContactInput,
} from "@/domain/contacts/types.ts";
import type { ContactRepository } from "@/repositories/contact_repository.ts";

export class ContactValidationError extends Error {}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeContactInput(
  input: ContactFormInput,
): NormalizedContactInput {
  const name = input.name.trim();
  const ico = nullable(input.ico);
  const dic = nullable(input.dic)?.toLocaleUpperCase("en-US") ?? null;
  const country = input.country.trim().toLocaleUpperCase("en-US");
  const email = nullable(input.email)?.toLocaleLowerCase("en-US") ?? null;
  const dueDaysValue = input.defaultDueDays.trim();
  const defaultDueDays = dueDaysValue === "" ? null : Number(dueDaysValue);

  if (!isContactType(input.type)) {
    throw new ContactValidationError("Vyberte platný typ kontaktu.");
  }
  if (name.length < 2 || name.length > 200) {
    throw new ContactValidationError("Název musí mít 2 až 200 znaků.");
  }
  if (ico && !/^[0-9]{8}$/.test(ico)) {
    throw new ContactValidationError("IČO musí obsahovat 8 číslic.");
  }
  if (dic && !/^[A-Z]{2}[A-Z0-9]{2,18}$/.test(dic)) {
    throw new ContactValidationError("DIČ nemá platný formát.");
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ContactValidationError("Země musí být dvoupísmenný ISO kód.");
  }
  if (
    email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    throw new ContactValidationError("E-mail nemá platný formát.");
  }
  if (
    defaultDueDays !== null &&
    (!Number.isInteger(defaultDueDays) || defaultDueDays < 0 ||
      defaultDueDays > 365)
  ) {
    throw new ContactValidationError(
      "Splatnost musí být celé číslo od 0 do 365.",
    );
  }
  if (
    input.street.length > 200 || input.city.length > 120 ||
    input.postalCode.length > 20
  ) {
    throw new ContactValidationError("Některý údaj adresy je příliš dlouhý.");
  }
  if (input.phone.length > 60 || input.note.length > 5_000) {
    throw new ContactValidationError("Telefon nebo poznámka je příliš dlouhá.");
  }

  return {
    type: input.type,
    name,
    ico,
    dic,
    street: nullable(input.street),
    city: nullable(input.city),
    postalCode: nullable(input.postalCode),
    country,
    email,
    phone: nullable(input.phone),
    defaultDueDays,
    note: nullable(input.note),
  };
}

export class ContactService {
  constructor(private readonly repository: ContactRepository) {}

  async create(
    input: ContactFormInput & {
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact | null> {
    return await this.repository.createForUser({
      ...normalizeContactInput(input),
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  async update(
    input: ContactFormInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact | null> {
    return await this.repository.updateForUser({
      ...normalizeContactInput(input),
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }
}
