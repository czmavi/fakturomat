import type {
  OrganizationSettings,
  OrganizationSettingsInput,
} from "@/domain/organizations/settings.ts";
import type { OrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import {
  OrganizationSettingsService,
  OrganizationSettingsValidationError,
} from "@/services/organization_settings_service.ts";
import type {
  ObjectStorage,
  StoredObject,
} from "@/services/storage/object_storage.ts";

const SETTINGS: OrganizationSettings = {
  id: "c06dc6f4-b37d-4b7e-843d-c1b9b92dfb61",
  type: "SRO",
  officialName: "Test s.r.o.",
  displayName: "Test",
  ico: null,
  dic: null,
  street: null,
  city: null,
  postalCode: null,
  country: "CZ",
  email: null,
  phone: null,
  website: null,
  logoStorageKey: null,
  logoMimeType: null,
  defaultCurrency: "CZK",
  defaultDueDays: 14,
  defaultInvoiceTemplateId: "10000000-0000-4000-8000-000000000001",
  invoiceFooter: null,
  customNote: null,
};

const INPUT: OrganizationSettingsInput = {
  type: "SRO",
  officialName: "Test s.r.o.",
  displayName: "Test",
  ico: "",
  dic: "",
  street: "",
  city: "",
  postalCode: "",
  country: "CZ",
  email: "",
  phone: "",
  website: "",
  defaultCurrency: "CZK",
  defaultDueDays: "14",
  defaultInvoiceTemplateId: "10000000-0000-4000-8000-000000000001",
  invoiceFooter: "",
  customNote: "",
};

const TEMPLATE_LOOKUP = {
  find: (templateId: string) =>
    Promise.resolve({
      id: templateId,
      name: "Default",
      description: null,
      isActive: true,
      currentVersionId: crypto.randomUUID(),
      currentVersion: 1,
      updatedAt: new Date(),
    }),
};

class FakeSettingsRepository implements OrganizationSettingsRepository {
  value: OrganizationSettings = { ...SETTINGS };

  findForUser(
    _organizationId: string,
    _userId: string,
  ): Promise<OrganizationSettings> {
    return Promise.resolve({ ...this.value });
  }

  updateForUser(
    input: OrganizationSettings & { userId: string },
  ): Promise<boolean> {
    this.value = { ...input };
    return Promise.resolve(true);
  }
}

class MemoryStorage implements ObjectStorage {
  objects = new Map<string, Uint8Array>();

  put(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, data);
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    const data = this.objects.get(key);
    return Promise.resolve(data ? { data } : null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("organization logo is validated and stored under an opaque key", async () => {
  const repository = new FakeSettingsRepository();
  const storage = new MemoryStorage();
  const png = new File(
    [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
    ],
    "user-controlled-name.png",
    { type: "image/png" },
  );

  const updated = await new OrganizationSettingsService(
    repository,
    storage,
    TEMPLATE_LOOKUP,
  )
    .update({
      organizationId: SETTINGS.id,
      userId: crypto.randomUUID(),
      values: INPUT,
      logo: png,
      removeLogo: false,
    });

  assert(updated, "settings were not updated");
  assert(
    repository.value.logoMimeType === "image/png",
    "logo MIME type was not stored",
  );
  assert(
    repository.value.logoStorageKey?.startsWith(
      `organizations/${SETTINGS.id}/logos/`,
    ) === true,
    "logo key is outside organization prefix",
  );
  assert(
    !repository.value.logoStorageKey?.includes("user-controlled-name"),
    "original filename leaked into storage key",
  );
  assert(storage.objects.size === 1, "logo bytes were not stored");
});

Deno.test("organization logo rejects spoofed MIME type", async () => {
  const service = new OrganizationSettingsService(
    new FakeSettingsRepository(),
    new MemoryStorage(),
    TEMPLATE_LOOKUP,
  );
  let rejected = false;
  try {
    await service.update({
      organizationId: SETTINGS.id,
      userId: crypto.randomUUID(),
      values: INPUT,
      logo: new File(["not an image"], "fake.png", { type: "image/png" }),
      removeLogo: false,
    });
  } catch (error) {
    rejected = error instanceof OrganizationSettingsValidationError;
  }
  assert(rejected, "spoofed image was accepted");
});
