import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import InvoiceTemplateForm, {
  invoiceTemplateInputFromForm,
} from "@/components/InvoiceTemplateForm.tsx";
import type { InvoiceTemplateInput } from "@/domain/invoices/template_types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
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
  async GET(ctx) {
    if (!isUuid(ctx.params.templateId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const repository = new PostgresInvoiceTemplateRepository();
    const template = await repository.find(ctx.params.templateId);
    if (template === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const version = await repository.findVersion(
      template.id,
      template.currentVersionId,
    );
    if (version === null) {
      return new Response("Verze nebyla nalezena.", { status: 404 });
    }
    return page({
      values: {
        name: template.name,
        description: template.description ?? "",
        html: version.html,
        css: version.css,
      },
      error: null,
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.templateId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    const values = invoiceTemplateInputFromForm(form);
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
      }, { status: 403 });
    }
    try {
      const version = await new InvoiceTemplateService(
        new PostgresInvoiceTemplateRepository(),
      ).createVersion({
        ...values,
        templateId: ctx.params.templateId,
        userId: ctx.state.user!.id,
      });
      if (version === null) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(`/templates/${ctx.params.templateId}`, 303);
    } catch (error) {
      if (error instanceof InvoiceTemplateValidationError) {
        return page({ values, error: error.message }, { status: 422 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:py-12">
    <Head>
      <title>Nová verze šablony · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-5xl">
      <a
        href={`/templates/${params.templateId}`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na šablonu
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Neměnná historie</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Nová verze šablony
        </h1>
        <InvoiceTemplateForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Uložit jako novou verzi"
        />
      </section>
    </div>
  </main>
));
