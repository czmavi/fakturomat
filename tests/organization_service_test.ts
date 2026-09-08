import type {
  OrganizationSummary,
  OrganizationType,
} from "@/domain/organizations/types.ts";
import type { OrganizationRepository } from "@/repositories/organization_repository.ts";
import {
  OrganizationService,
  OrganizationValidationError,
} from "@/services/organization_service.ts";

class FakeOrganizationRepository implements OrganizationRepository {
  created: OrganizationSummary | null = null;

  listForUser(_userId: string): Promise<OrganizationSummary[]> {
    return Promise.resolve(this.created ? [this.created] : []);
  }

  findForUser(
    _organizationId: string,
    _userId: string,
  ): Promise<OrganizationSummary | null> {
    return Promise.resolve(this.created);
  }

  createWithOwner(input: {
    id: string;
    type: OrganizationType;
    officialName: string;
    displayName: string;
    ownerUserId: string;
  }): Promise<OrganizationSummary> {
    this.created = { ...input, role: "OWNER" };
    return Promise.resolve(this.created);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("organization creation trims names and assigns owner", async () => {
  const repository = new FakeOrganizationRepository();
  const service = new OrganizationService(repository);
  const organization = await service.create({
    type: "SRO",
    officialName: "  Testovací firma s.r.o. ",
    displayName: " Testovací firma ",
    ownerUserId: crypto.randomUUID(),
  });

  assert(
    organization.officialName === "Testovací firma s.r.o.",
    "official name was not trimmed",
  );
  assert(
    organization.displayName === "Testovací firma",
    "display name was not trimmed",
  );
  assert(organization.role === "OWNER", "creator is not the owner");
});

Deno.test("organization creation rejects invalid type", async () => {
  const service = new OrganizationService(new FakeOrganizationRepository());
  let rejected = false;
  try {
    await service.create({
      type: "INVALID",
      officialName: "Test organization",
      displayName: "Test",
      ownerUserId: crypto.randomUUID(),
    });
  } catch (error) {
    rejected = error instanceof OrganizationValidationError;
  }
  assert(rejected, "invalid organization type was accepted");
});
