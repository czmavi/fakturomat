import {
  isOrganizationType,
  type OrganizationBillingInput,
  type OrganizationSummary,
} from "@/domain/organizations/types.ts";
import type { OrganizationRepository } from "@/repositories/organization_repository.ts";

export class OrganizationValidationError extends Error {}

export class OrganizationService {
  constructor(private readonly repository: OrganizationRepository) {}

  async create(
    input: OrganizationBillingInput & {
      type: string;
      officialName: string;
      displayName: string;
      ownerUserId: string;
    },
  ): Promise<OrganizationSummary> {
    const officialName = input.officialName.trim();
    const displayName = input.displayName.trim();

    if (!isOrganizationType(input.type)) {
      throw new OrganizationValidationError("Vyberte platný typ subjektu.");
    }
    if (officialName.length < 2 || officialName.length > 200) {
      throw new OrganizationValidationError(
        "Oficiální název musí mít 2 až 200 znaků.",
      );
    }
    if (displayName.length < 2 || displayName.length > 120) {
      throw new OrganizationValidationError(
        "Zobrazovaný název musí mít 2 až 120 znaků.",
      );
    }

    const billing = {
      ico: input.ico?.trim() ?? "",
      dic: input.dic?.trim().toUpperCase() ?? "",
      street: input.street?.trim() ?? "",
      city: input.city?.trim() ?? "",
      postalCode: input.postalCode?.trim() ?? "",
      country: (input.country ?? "CZ").trim().toUpperCase(),
    };
    if (billing.ico && !/^[0-9]{8}$/.test(billing.ico)) {
      throw new OrganizationValidationError("IČO musí obsahovat 8 číslic.");
    }
    if (billing.dic && !/^[A-Z]{2}[A-Z0-9]{2,18}$/.test(billing.dic)) {
      throw new OrganizationValidationError("DIČ nemá platný formát.");
    }
    if (!/^[A-Z]{2}$/.test(billing.country)) {
      throw new OrganizationValidationError(
        "Země musí být dvoupísmenný ISO kód.",
      );
    }
    if (
      billing.street.length > 200 || billing.city.length > 120 ||
      billing.postalCode.length > 20
    ) {
      throw new OrganizationValidationError(
        "Adresa překračuje povolenou délku.",
      );
    }

    return await this.repository.createWithOwner({
      ...billing,
      id: crypto.randomUUID(),
      type: input.type,
      officialName,
      displayName,
      ownerUserId: input.ownerUserId,
    });
  }
}
