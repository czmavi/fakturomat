import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import InvoiceForm, {
  invoiceDraftInputFromForm,
} from "@/components/InvoiceForm.tsx";
import type { InvoiceDraftFormInput } from "@/domain/invoices/types.ts";
import type { InvoiceFormOptions } from "@/components/InvoiceForm.tsx";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import { loadInvoiceFormOptions } from "@/services/invoice_form_options.ts";
import {
  InvoiceService,
  InvoiceValidationError,
} from "@/services/invoice_service.ts";

interface PageData extends InvoiceFormOptions {
  values: InvoiceDraftFormInput;
  error: string | null;
}

function todayInPrague(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const organizationId = ctx.params.organizationId;
    const userId = ctx.state.user!.id;
    const [settings, options] = await Promise.all([
      new PostgresOrganizationSettingsRepository().findForUser(
        organizationId,
        userId,
      ),
      loadInvoiceFormOptions(organizationId, userId),
    ]);
    if (!settings) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const issueDate = todayInPrague();
    return page({
      ...options,
      values: {
        contactId: "",
        numberSequenceId: options.numberSequences.find((item) =>
          item.isDefault
        )?.id ?? options.numberSequences[0]?.id ?? "",
        bankAccountId: options.bankAccounts.find((item) =>
          item.isDefault
        )?.id ?? "",
        invoiceTemplateId: settings.defaultInvoiceTemplateId,
        variableSymbol: "",
        issueDate,
        dueDate: addDays(issueDate, settings.defaultDueDays),
        currency: settings.defaultCurrency,
        note: "",
        items: [{ description: "", quantity: "1", unit: "ks", unitPrice: "" }],
      },
      error: null,
    });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const values = invoiceDraftInputFromForm(form);
    const renderError = async (message: string, status: number) =>
      page({
        ...await loadInvoiceFormOptions(
          ctx.params.organizationId,
          ctx.state.user!.id,
          {
            contactId: values.contactId,
            numberSequenceId: values.numberSequenceId,
            bankAccountId: values.bankAccountId,
            invoiceTemplateId: values.invoiceTemplateId,
          },
        ),
        values,
        error: message,
      }, { status });
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return await renderError(
        "Platnost formuláře vypršela. Zkuste to znovu.",
        403,
      );
    }
    try {
      const invoice = await new InvoiceService(new PostgresInvoiceRepository())
        .createDraft({
          ...values,
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
        });
      if (!invoice) {
        return await renderError(
          "Vybrané fakturační údaje už nejsou dostupné.",
          422,
        );
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/invoices/${invoice.id}`,
        303,
      );
    } catch (error) {
      if (error instanceof InvoiceValidationError) {
        return await renderError(error.message, 422);
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Nový koncept faktury · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-6xl">
      <a
        href={`/o/${params.organizationId}/invoices`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na faktury
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Faktura bez DPH</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Nový koncept</h1>
        <p class="mt-2 text-sm text-[#667169]">
          Číslo faktury se přidělí až při vystavení.
        </p>
        <InvoiceForm
          {...data}
          csrfToken={state.csrfToken}
          submitLabel="Uložit koncept"
        />
      </section>
    </div>
  </main>
));
