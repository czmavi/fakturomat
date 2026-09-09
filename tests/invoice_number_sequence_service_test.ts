import type { InvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";
import type {
  InvoiceNumberSequence,
  NormalizedInvoiceNumberSequenceInput,
} from "@/domain/invoices/number_sequence_types.ts";
import {
  InvoiceNumberSequenceService,
  InvoiceNumberSequenceValidationError,
} from "@/services/invoice_number_sequence_service.ts";

class FakeSequenceRepository implements InvoiceNumberSequenceRepository {
  created: NormalizedInvoiceNumberSequenceInput | null = null;
  listForUser(): Promise<InvoiceNumberSequence[]> {
    return Promise.resolve([]);
  }
  findForUser(): Promise<InvoiceNumberSequence | null> {
    return Promise.resolve(null);
  }
  createForUser(
    input: NormalizedInvoiceNumberSequenceInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<InvoiceNumberSequence | null> {
    this.created = input;
    return Promise.resolve(null);
  }
  updateForUser(): Promise<InvoiceNumberSequence | null> {
    return Promise.resolve(null);
  }
  allocateNextForUser(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("number sequence normalizes a safe prefix", async () => {
  const repository = new FakeSequenceRepository();
  await new InvoiceNumberSequenceService(repository).create({
    organizationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    name: "  Služby ",
    prefix: " sd- ",
    padding: "4",
    isDefault: true,
    isActive: true,
  });
  assert(repository.created?.name === "Služby", "name was not trimmed");
  assert(repository.created?.prefix === "SD-", "prefix was not normalized");
});

Deno.test("inactive sequence cannot be default", async () => {
  let rejected = false;
  try {
    await new InvoiceNumberSequenceService(new FakeSequenceRepository()).create(
      {
        organizationId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
        name: "Test",
        prefix: "",
        padding: "4",
        isDefault: true,
        isActive: false,
      },
    );
  } catch (error) {
    rejected = error instanceof InvoiceNumberSequenceValidationError;
  }
  assert(rejected, "inactive default sequence was accepted");
});
