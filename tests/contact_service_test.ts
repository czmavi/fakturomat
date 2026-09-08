import type {
  Contact,
  NormalizedContactInput,
} from "@/domain/contacts/types.ts";
import type { ContactRepository } from "@/repositories/contact_repository.ts";
import {
  ContactService,
  ContactValidationError,
} from "@/services/contact_service.ts";

class FakeContactRepository implements ContactRepository {
  created:
    | (NormalizedContactInput & { id: string; organizationId: string })
    | null = null;

  listForUser(_input: {
    organizationId: string;
    userId: string;
    search: string;
    includeArchived: boolean;
  }): Promise<Contact[]> {
    return Promise.resolve([]);
  }

  findForUser(
    _organizationId: string,
    _contactId: string,
    _userId: string,
  ): Promise<Contact | null> {
    return Promise.resolve(null);
  }

  createForUser(
    input: NormalizedContactInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact> {
    this.created = input;
    return Promise.resolve(this.toContact(input));
  }

  updateForUser(
    input: NormalizedContactInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Contact> {
    return Promise.resolve(this.toContact(input));
  }

  archiveForUser(
    _organizationId: string,
    _contactId: string,
    _userId: string,
  ): Promise<boolean> {
    return Promise.resolve(true);
  }

  private toContact(
    input: NormalizedContactInput & { id: string; organizationId: string },
  ): Contact {
    return {
      ...input,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("contact creation normalizes values for future copy operation", async () => {
  const repository = new FakeContactRepository();
  const contact = await new ContactService(repository).create({
    organizationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    type: "COMPANY",
    name: "  Acme s.r.o. ",
    ico: "12345678",
    dic: " cz12345678 ",
    street: " Main 1 ",
    city: " Prague ",
    postalCode: " 110 00 ",
    country: "cz",
    email: " INFO@EXAMPLE.TEST ",
    phone: "",
    defaultDueDays: "30",
    note: "",
  });

  assert(contact?.name === "Acme s.r.o.", "name was not trimmed");
  assert(repository.created?.dic === "CZ12345678", "DIČ was not normalized");
  assert(
    repository.created?.email === "info@example.test",
    "email was not normalized",
  );
  assert(repository.created?.phone === null, "empty phone was not normalized");
  assert(repository.created?.defaultDueDays === 30, "due days were not parsed");
});

Deno.test("contact rejects invalid due days", async () => {
  let rejected = false;
  try {
    await new ContactService(new FakeContactRepository()).create({
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      type: "PERSON",
      name: "Test Person",
      ico: "",
      dic: "",
      street: "",
      city: "",
      postalCode: "",
      country: "CZ",
      email: "",
      phone: "",
      defaultDueDays: "12.5",
      note: "",
    });
  } catch (error) {
    rejected = error instanceof ContactValidationError;
  }
  assert(rejected, "decimal due days were accepted");
});
