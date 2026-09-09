import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ExpenseForm, {
  type ExpenseFormOptions,
  expenseInputFromForm,
} from "@/components/ExpenseForm.tsx";
import type { ExpenseFormInput } from "@/domain/expenses/types.ts";
import { PostgresExpenseRepository } from "@/repositories/expense_repository.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import { loadExpenseFormOptions } from "@/services/expense_form_options.ts";
import {
  ExpenseService,
  ExpenseValidationError,
} from "@/services/expense_service.ts";

interface PageData extends ExpenseFormOptions {
  values: ExpenseFormInput;
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

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const organizationId = ctx.params.organizationId;
    const userId = ctx.state.user!.id;
    const [settings, options] = await Promise.all([
      new PostgresOrganizationSettingsRepository().findForUser(
        organizationId,
        userId,
      ),
      loadExpenseFormOptions(organizationId, userId),
    ]);
    if (!settings) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      ...options,
      values: {
        contactId: "",
        documentType: "INVOICE",
        supplierName: "",
        supplierInvoiceNumber: "",
        issueDate: todayInPrague(),
        taxableSupplyDate: "",
        dueDate: "",
        paymentDate: "",
        description: "",
        categoryId: options.categories.find((category) =>
          category.name === "Ostatní" && category.isActive
        )?.id ?? "",
        currency: settings.defaultCurrency,
        totalAmount: "",
        note: "",
        vatLines: [],
      },
      error: null,
    });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const values = expenseInputFromForm(form);
    const renderError = async (message: string, status: number) =>
      page({
        ...await loadExpenseFormOptions(
          ctx.params.organizationId,
          ctx.state.user!.id,
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
      const expense = await new ExpenseService(new PostgresExpenseRepository())
        .create({
          ...values,
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
        });
      if (!expense) {
        return await renderError(
          "Vybraný kontakt nebo kategorie nejsou dostupné.",
          422,
        );
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/expenses/${expense.id}`,
        303,
      );
    } catch (error) {
      if (error instanceof ExpenseValidationError) {
        return await renderError(error.message, 422);
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Nový náklad · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-4xl">
      <a
        href={`/o/${params.organizationId}/expenses`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na náklady
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Evidence výdajů</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Nový náklad</h1>
        <ExpenseForm
          {...data}
          csrfToken={state.csrfToken}
          submitLabel="Uložit náklad"
        />
      </section>
    </div>
  </main>
));
