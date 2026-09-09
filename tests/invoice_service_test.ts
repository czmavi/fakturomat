import type { InvoiceRepository } from "@/repositories/invoice_repository.ts";
import type { IssueInvoiceResult } from "@/repositories/invoice_repository.ts";
import type { InvoiceDocumentPreparer } from "@/domain/invoices/invoice_document.ts";
import type {
  Invoice,
  InvoiceStatus,
  InvoiceSummary,
  NormalizedInvoiceDraftInput,
} from "@/domain/invoices/types.ts";
import {
  InvoiceService,
  InvoiceValidationError,
} from "@/services/invoice_service.ts";

class FakeInvoiceRepository implements InvoiceRepository {
  created: (NormalizedInvoiceDraftInput & { id: string }) | null = null;

  listForUser(_input: {
    organizationId: string;
    userId: string;
    status: InvoiceStatus | null;
  }): Promise<InvoiceSummary[]> {
    return Promise.resolve([]);
  }

  findForUser(
    _organizationId: string,
    _invoiceId: string,
    _userId: string,
  ): Promise<Invoice | null> {
    return Promise.resolve(null);
  }

  createDraftForUser(
    input: NormalizedInvoiceDraftInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null> {
    this.created = input;
    return Promise.resolve(null);
  }

  updateDraftForUser(
    _input: NormalizedInvoiceDraftInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<Invoice | null> {
    return Promise.resolve(null);
  }

  issueForUser(
    _input: { organizationId: string; invoiceId: string; userId: string },
    _documentPreparer: InvoiceDocumentPreparer,
  ): Promise<IssueInvoiceResult> {
    return Promise.resolve({ kind: "not_found" });
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const IDS = {
  organizationId: "10000000-0000-4000-8000-000000000010",
  userId: "10000000-0000-4000-8000-000000000011",
  contactId: "10000000-0000-4000-8000-000000000012",
  sequenceId: "10000000-0000-4000-8000-000000000013",
  templateId: "10000000-0000-4000-8000-000000000014",
};

Deno.test("invoice draft computes exact totals and normalizes items", async () => {
  const repository = new FakeInvoiceRepository();
  await new InvoiceService(repository).createDraft({
    organizationId: IDS.organizationId,
    userId: IDS.userId,
    contactId: IDS.contactId,
    numberSequenceId: IDS.sequenceId,
    bankAccountId: "",
    invoiceTemplateId: IDS.templateId,
    variableSymbol: " 123 ",
    issueDate: "2026-09-09",
    dueDate: "2026-09-23",
    currency: " czk ",
    note: " Test ",
    items: [
      {
        description: " Práce ",
        quantity: "1.5",
        unit: " hod ",
        unitPrice: "999.90",
      },
      { description: "Materiál", quantity: "2", unit: "ks", unitPrice: "0.05" },
    ],
  });
  assert(repository.created?.total === "1499.95", "draft total is not exact");
  assert(
    repository.created?.items[0].total === "1499.85",
    "line total is not exact",
  );
  assert(repository.created?.currency === "CZK", "currency was not normalized");
  assert(
    repository.created?.items[0].quantity === "1.5",
    "quantity was not normalized",
  );
});

Deno.test("invoice draft rejects invalid dates and decimal precision", async () => {
  const service = new InvoiceService(new FakeInvoiceRepository());
  for (
    const [issueDate, dueDate, unitPrice] of [
      ["2026-02-30", "2026-03-10", "10.00"],
      ["2026-09-10", "2026-09-09", "10.00"],
      ["2026-09-09", "2026-09-10", "10.001"],
    ]
  ) {
    let rejected = false;
    try {
      await service.createDraft({
        organizationId: IDS.organizationId,
        userId: IDS.userId,
        contactId: IDS.contactId,
        numberSequenceId: IDS.sequenceId,
        bankAccountId: "",
        invoiceTemplateId: IDS.templateId,
        variableSymbol: "",
        issueDate,
        dueDate,
        currency: "CZK",
        note: "",
        items: [{ description: "Test", quantity: "1", unit: "ks", unitPrice }],
      });
    } catch (error) {
      rejected = error instanceof InvoiceValidationError;
    }
    assert(rejected, "invalid draft was accepted");
  }
});
