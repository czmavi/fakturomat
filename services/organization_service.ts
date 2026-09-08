import {
  isOrganizationType,
  type OrganizationSummary,
} from "@/domain/organizations/types.ts";
import type { OrganizationRepository } from "@/repositories/organization_repository.ts";

export class OrganizationValidationError extends Error {}

export class OrganizationService {
  constructor(private readonly repository: OrganizationRepository) {}

  async create(input: {
    type: string;
    officialName: string;
    displayName: string;
    ownerUserId: string;
  }): Promise<OrganizationSummary> {
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

    return await this.repository.createWithOwner({
      id: crypto.randomUUID(),
      type: input.type,
      officialName,
      displayName,
      ownerUserId: input.ownerUserId,
    });
  }
}
