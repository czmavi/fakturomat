import type { InvoiceFormOptions } from "@/components/InvoiceForm.tsx";
import { D1BankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { D1ContactRepository } from "@/repositories/contact_repository.ts";
import { D1InvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";
import { D1InvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";

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
      new D1ContactRepository().listForUser({
        organizationId,
        userId,
        search: "",
        includeArchived: true,
      }),
      new D1InvoiceNumberSequenceRepository().listForUser(
        organizationId,
        userId,
      ),
      new D1BankAccountRepository().listForUser(organizationId, userId),
      new D1InvoiceTemplateRepository().listForUser({
        organizationId,
        userId,
      }),
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
