export const CONTACT_TYPES = ["PERSON", "COMPANY"] as const;
export type ContactType = typeof CONTACT_TYPES[number];

export interface Contact {
  id: string;
  organizationId: string;
  type: ContactType;
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  defaultDueDays: number | null;
  note: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactFormInput {
  type: string;
  name: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  email: string;
  phone: string;
  defaultDueDays: string;
  note: string;
}

export interface NormalizedContactInput {
  type: ContactType;
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  defaultDueDays: number | null;
  note: string | null;
}

export function isContactType(value: string): value is ContactType {
  return (CONTACT_TYPES as readonly string[]).includes(value);
}

export function contactTypeLabel(type: ContactType): string {
  return type === "COMPANY" ? "Firma" : "Osoba";
}
