import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ExpenseCategoryForm, {
  expenseCategoryInputFromForm,
} from "@/components/ExpenseCategoryForm.tsx";
import type { ExpenseCategoryInput } from "@/domain/expenses/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import {
  ExpenseCategoryService,
  ExpenseCategoryValidationError,
} from "@/services/expense_category_service.ts";

interface PageData {
  values: ExpenseCategoryInput;
  error: string | null;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.categoryId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const category = await new PostgresExpenseCategoryRepository().findForUser(
      ctx.params.organizationId,
      ctx.params.categoryId,
      ctx.state.user!.id,
    );
    if (!category) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      values: { name: category.name, isActive: category.isActive },
      error: null,
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.categoryId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    const values = expenseCategoryInputFromForm(form);
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
      }, { status: 403 });
    }
    try {
      const category = await new ExpenseCategoryService(
        new PostgresExpenseCategoryRepository(),
      ).update({
        ...values,
        id: ctx.params.categoryId,
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
      });
      if (!category) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/settings/expense-categories`,
        303,
      );
    } catch (error) {
      if (error instanceof ExpenseCategoryValidationError) {
        return page({ values, error: error.message }, { status: 422 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Upravit kategorii nákladů · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-2xl">
      <a
        href={`/o/${params.organizationId}/settings/expense-categories`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na kategorie
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Náklady</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Upravit kategorii
        </h1>
        <ExpenseCategoryForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Uložit kategorii"
        />
      </section>
    </div>
  </main>
));
