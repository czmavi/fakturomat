import type { ContactType } from "@/domain/contacts/types.ts";

export interface AresCompany {
  contactType: ContactType | null;
  name: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
}
