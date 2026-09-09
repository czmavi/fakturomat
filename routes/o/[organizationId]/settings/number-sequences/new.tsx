import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import InvoiceNumberSequenceForm, {
  EMPTY_INVOICE_NUMBER_SEQUENCE,
  invoiceNumberSequenceInputFromForm,
} from "@/components/InvoiceNumberSequenceForm.tsx";
import type { InvoiceNumberSequenceInput } from "@/domain/invoices/number_sequence_types.ts";
import { PostgresInvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import {
  InvoiceNumberSequenceService,
  InvoiceNumberSequenceValidationError,
} from "@/services/invoice_number_sequence_service.ts";

interface PageData {
  values: InvoiceNumberSequenceInput;
  error: string | null;
}

export const handler = define.handlers<PageData>({
  GET() {
    return page({ values: EMPTY_INVOICE_NUMBER_SEQUENCE, error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const values = invoiceNumberSequenceInputFromForm(form);
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
      }, { status: 403 });
    }
    try {
      const sequence = await new InvoiceNumberSequenceService(
        new PostgresInvoiceNumberSequenceRepository(),
      ).create({
        ...values,
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
      });
      if (!sequence) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/settings/number-sequences`,
        303,
      );
    } catch (error) {
      if (error instanceof InvoiceNumberSequenceValidationError) {
        return page({ values, error: error.message }, { status: 422 });
      }
      if (
        typeof error === "object" && error !== null && "code" in error &&
        error.code === "23505"
      ) {
        return page({
          values,
          error: "Číselná řada s tímto názvem už existuje.",
        }, { status: 409 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Nová číselná řada · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-2xl">
      <a
        href={`/o/${params.organizationId}/settings/number-sequences`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na číselné řady
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Faktury</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Nová číselná řada
        </h1>
        <InvoiceNumberSequenceForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Vytvořit řadu"
        />
      </section>
    </div>
  </main>
));
