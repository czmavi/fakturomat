import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import InvoiceTemplateForm, {
  EMPTY_INVOICE_TEMPLATE,
  invoiceTemplateInputFromForm,
} from "@/components/InvoiceTemplateForm.tsx";
import type { InvoiceTemplateInput } from "@/domain/invoices/template_types.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import {
  InvoiceTemplateService,
  InvoiceTemplateValidationError,
} from "@/services/invoice_template_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface PageData {
  values: InvoiceTemplateInput;
  error: string | null;
}

export const handler = define.handlers<PageData>({
  GET() {
    return page({ values: EMPTY_INVOICE_TEMPLATE, error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const values = invoiceTemplateInputFromForm(form);
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
      }, { status: 403 });
    }
    try {
      const template = await new InvoiceTemplateService(
        new PostgresInvoiceTemplateRepository(),
      ).create({ ...values, userId: ctx.state.user!.id });
      return ctx.redirect(`/templates/${template.id}`, 303);
    } catch (error) {
      if (error instanceof InvoiceTemplateValidationError) {
        return page({ values, error: error.message }, { status: 422 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state }) => (
  <main class="px-5 py-10 lg:py-12">
    <Head>
      <title>Nová šablona · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-5xl">
      <a
        href="/templates"
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na šablony
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Globální knihovna</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Nová šablona</h1>
        <InvoiceTemplateForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Vytvořit šablonu"
        />
      </section>
    </div>
  </main>
));
