import type {
  OrganizationSettings,
  OrganizationSettingsInput,
} from "@/domain/organizations/settings.ts";
import { isOrganizationType } from "@/domain/organizations/types.ts";
import type { OrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import type { ObjectStorage } from "@/services/storage/object_storage.ts";

export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
export class OrganizationSettingsValidationError extends Error {}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validateLogo(file: File): { mimeType: string; extension: string } {
  if (file.size <= 0 || file.size > MAX_LOGO_SIZE_BYTES) {
    throw new OrganizationSettingsValidationError(
      "Logo musí mít nejvýše 2 MB.",
    );
  }
  const formats: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = formats[file.type];
  if (!extension) {
    throw new OrganizationSettingsValidationError(
      "Logo musí být PNG, JPEG nebo WebP.",
    );
  }
  return { mimeType: file.type, extension };
}

function hasExpectedSignature(data: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return data.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => data[i] === value);
  }
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 &&
      data[2] === 0xff;
  }
  return data.length >= 12 &&
    new TextDecoder().decode(data.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(data.slice(8, 12)) === "WEBP";
}

function normalizeSettings(
  current: OrganizationSettings,
  input: OrganizationSettingsInput,
): OrganizationSettings {
  const officialName = input.officialName.trim();
  const displayName = input.displayName.trim();
  const ico = nullable(input.ico);
  const dic = nullable(input.dic)?.toLocaleUpperCase("en-US") ?? null;
  const country = input.country.trim().toLocaleUpperCase("en-US");
  const email = nullable(input.email)?.toLocaleLowerCase("en-US") ?? null;
  const website = nullable(input.website);
  const defaultCurrency = input.defaultCurrency.trim().toLocaleUpperCase(
    "en-US",
  );
  const defaultDueDays = Number(input.defaultDueDays);

  if (!isOrganizationType(input.type)) {
    throw new OrganizationSettingsValidationError(
      "Vyberte platný typ subjektu.",
    );
  }
  if (officialName.length < 2 || officialName.length > 200) {
    throw new OrganizationSettingsValidationError(
      "Oficiální název musí mít 2 až 200 znaků.",
    );
  }
  if (displayName.length < 2 || displayName.length > 120) {
    throw new OrganizationSettingsValidationError(
      "Zobrazovaný název musí mít 2 až 120 znaků.",
    );
  }
  if (ico && !/^[0-9]{8}$/.test(ico)) {
    throw new OrganizationSettingsValidationError(
      "IČO musí obsahovat 8 číslic.",
    );
  }
  if (dic && !/^[A-Z]{2}[A-Z0-9]{2,18}$/.test(dic)) {
    throw new OrganizationSettingsValidationError("DIČ nemá platný formát.");
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new OrganizationSettingsValidationError(
      "Země musí být dvoupísmenný ISO kód.",
    );
  }
  if (
    email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    throw new OrganizationSettingsValidationError("E-mail nemá platný formát.");
  }
  if (website) {
    try {
      const url = new URL(website);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error();
      }
    } catch {
      throw new OrganizationSettingsValidationError(
        "Web musí být platná HTTP nebo HTTPS adresa.",
      );
    }
  }
  if (
    input.street.length > 200 || input.city.length > 120 ||
    input.postalCode.length > 20
  ) {
    throw new OrganizationSettingsValidationError(
      "Některý údaj adresy je příliš dlouhý.",
    );
  }
  if (input.phone.length > 60 || (website?.length ?? 0) > 300) {
    throw new OrganizationSettingsValidationError(
      "Telefon nebo web je příliš dlouhý.",
    );
  }
  if (!/^[A-Z]{3}$/.test(defaultCurrency)) {
    throw new OrganizationSettingsValidationError(
      "Měna musí být třípísmenný ISO kód.",
    );
  }
  if (
    !Number.isInteger(defaultDueDays) || defaultDueDays < 0 ||
    defaultDueDays > 365
  ) {
    throw new OrganizationSettingsValidationError(
      "Splatnost musí být celé číslo od 0 do 365.",
    );
  }
  if (input.invoiceFooter.length > 2_000 || input.customNote.length > 5_000) {
    throw new OrganizationSettingsValidationError(
      "Patička nebo poznámka je příliš dlouhá.",
    );
  }

  return {
    ...current,
    type: input.type,
    officialName,
    displayName,
    ico,
    dic,
    street: nullable(input.street),
    city: nullable(input.city),
    postalCode: nullable(input.postalCode),
    country,
    email,
    phone: nullable(input.phone),
    website,
    defaultCurrency,
    defaultDueDays,
    invoiceFooter: nullable(input.invoiceFooter),
    customNote: nullable(input.customNote),
  };
}

export class OrganizationSettingsService {
  constructor(
    private readonly repository: OrganizationSettingsRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async update(input: {
    organizationId: string;
    userId: string;
    values: OrganizationSettingsInput;
    logo: File | null;
    removeLogo: boolean;
  }): Promise<boolean> {
    const current = await this.repository.findForUser(
      input.organizationId,
      input.userId,
    );
    if (current === null) return false;

    const settings = normalizeSettings(current, input.values);
    let newKey: string | null = null;
    const previousKey = current.logoStorageKey;

    if (input.logo && input.logo.size > 0) {
      const format = validateLogo(input.logo);
      const data = new Uint8Array(await input.logo.arrayBuffer());
      if (!hasExpectedSignature(data, format.mimeType)) {
        throw new OrganizationSettingsValidationError(
          "Obsah souboru neodpovídá typu obrázku.",
        );
      }
      newKey =
        `organizations/${input.organizationId}/logos/${crypto.randomUUID()}.${format.extension}`;
      await this.storage.put(newKey, data);
      settings.logoStorageKey = newKey;
      settings.logoMimeType = format.mimeType;
    } else if (input.removeLogo) {
      settings.logoStorageKey = null;
      settings.logoMimeType = null;
    }

    try {
      const updated = await this.repository.updateForUser({
        ...settings,
        userId: input.userId,
      });
      if (!updated && newKey) await this.storage.delete(newKey);
      if (!updated) return false;
    } catch (error) {
      if (newKey) await this.storage.delete(newKey);
      throw error;
    }

    if (previousKey && previousKey !== settings.logoStorageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch {
        console.warn(
          "Previous organization logo could not be removed from object storage.",
        );
      }
    }
    return true;
  }
}
