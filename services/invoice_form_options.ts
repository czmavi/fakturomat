import type { InvoiceFormOptions } from "@/components/InvoiceForm.tsx";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import { PostgresInvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";

interface CurrentSelections {
  contactId?: string;
  numberSequenceId?: string;
  bankAccountId?: string | null;
  invoiceTemplateId?: string;
}

export async function loadInvoiceFormOptions(
  organizationId: string,
  userId: string,
  current: CurrentSelections = {},
): Promise<InvoiceFormOptions> {
  const [contacts, numberSequences, bankAccounts, templates] = await Promise
    .all([
      new PostgresContactRepository().listForUser({
        organizationId,
        userId,
        search: "",
        includeArchived: true,
      }),
      new PostgresInvoiceNumberSequenceRepository().listForUser(
        organizationId,
        userId,
      ),
      new PostgresBankAccountRepository().listForUser(organizationId, userId),
      new PostgresInvoiceTemplateRepository().list(),
    ]);
  return {
    contacts: contacts.filter((item) =>
      item.archivedAt === null || item.id === current.contactId
    ),
    numberSequences: numberSequences.filter((item) =>
      item.isActive || item.id === current.numberSequenceId
    ),
    bankAccounts: bankAccounts.filter((item) =>
      item.isActive || item.id === current.bankAccountId
    ),
    templates: templates.filter((item) =>
      item.isActive || item.id === current.invoiceTemplateId
    ),
  };
}
