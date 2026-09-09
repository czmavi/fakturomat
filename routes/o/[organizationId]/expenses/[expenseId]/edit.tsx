import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ExpenseForm, {
  type ExpenseFormOptions,
  expenseInputFromExpense,
  expenseInputFromForm,
} from "@/components/ExpenseForm.tsx";
import type { ExpenseFormInput } from "@/domain/expenses/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseRepository } from "@/repositories/expense_repository.ts";
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

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.expenseId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const repository = new PostgresExpenseRepository();
    const expense = await repository.findForUser(
      ctx.params.organizationId,
      ctx.params.expenseId,
      ctx.state.user!.id,
    );
    if (!expense) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      ...await loadExpenseFormOptions(
        ctx.params.organizationId,
        ctx.state.user!.id,
      ),
      values: expenseInputFromExpense(expense),
      error: null,
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.expenseId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
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
        .update({
          ...values,
          id: ctx.params.expenseId,
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
        });
      if (!expense) {
        return await renderError(
          "Náklad nebo vybrané vazby už nejsou dostupné.",
          409,
        );
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/expenses/${expense.id}?saved=1`,
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
      <title>Upravit náklad · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-4xl">
      <a
        href={`/o/${params.organizationId}/expenses/${params.expenseId}`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na detail
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Evidence výdajů</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Upravit náklad
        </h1>
        <ExpenseForm
          {...data}
          csrfToken={state.csrfToken}
          submitLabel="Uložit změny"
        />
      </section>
    </div>
  </main>
));
