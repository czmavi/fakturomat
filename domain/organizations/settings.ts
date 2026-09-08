import type { OrganizationType } from "@/domain/organizations/types.ts";

export interface OrganizationSettings {
  id: string;
  type: OrganizationType;
  officialName: string;
  displayName: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoStorageKey: string | null;
  logoMimeType: string | null;
  defaultCurrency: string;
  defaultDueDays: number;
  invoiceFooter: string | null;
  customNote: string | null;
}

export interface OrganizationSettingsInput {
  type: string;
  officialName: string;
  displayName: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  defaultCurrency: string;
  defaultDueDays: string;
  invoiceFooter: string;
  customNote: string;
}
