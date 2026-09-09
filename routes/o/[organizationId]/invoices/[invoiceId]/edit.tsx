import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import InvoiceForm, {
  invoiceDraftInputFromForm,
  invoiceDraftInputFromInvoice,
  type InvoiceFormOptions,
} from "@/components/InvoiceForm.tsx";
import type { InvoiceDraftFormInput } from "@/domain/invoices/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
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

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.invoiceId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const repository = new PostgresInvoiceRepository();
    const invoice = await repository.findForUser(
      ctx.params.organizationId,
      ctx.params.invoiceId,
      ctx.state.user!.id,
    );
    if (!invoice) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    if (invoice.status !== "DRAFT") {
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/invoices/${invoice.id}`,
        303,
      );
    }
    return page({
      ...await loadInvoiceFormOptions(
        ctx.params.organizationId,
        ctx.state.user!.id,
        invoice,
      ),
      values: invoiceDraftInputFromInvoice(invoice),
      error: null,
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.invoiceId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
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
        .updateDraft({
          ...values,
          id: ctx.params.invoiceId,
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
        });
      if (!invoice) {
        return await renderError(
          "Koncept už nelze upravit nebo vybrané údaje nejsou dostupné.",
          409,
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
      <title>Upravit koncept faktury · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-6xl">
      <a
        href={`/o/${params.organizationId}/invoices/${params.invoiceId}`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na koncept
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Faktura bez DPH</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Upravit koncept
        </h1>
        <InvoiceForm
          {...data}
          csrfToken={state.csrfToken}
          submitLabel="Uložit změny"
        />
      </section>
    </div>
  </main>
));
