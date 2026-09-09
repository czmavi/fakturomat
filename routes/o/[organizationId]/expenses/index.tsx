import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import {
  EXPENSE_DOCUMENT_TYPES,
  type ExpenseCategory,
  type ExpenseDocumentType,
  expenseDocumentTypeLabel,
  type ExpenseSummary,
} from "@/domain/expenses/types.ts";
import { formatMoneyForDisplay } from "@/domain/invoices/money.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";
import { PostgresExpenseRepository } from "@/repositories/expense_repository.ts";

interface PageData {
  expenses: ExpenseSummary[];
  categories: ExpenseCategory[];
  search: string;
  categoryId: string | null;
  documentType: ExpenseDocumentType | null;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const search = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 200);
    const requestedCategory = ctx.url.searchParams.get("category");
    const categoryId = requestedCategory && isUuid(requestedCategory)
      ? requestedCategory
      : null;
    const requestedType = ctx.url.searchParams.get("type");
    const documentType = EXPENSE_DOCUMENT_TYPES.includes(
        requestedType as ExpenseDocumentType,
      )
      ? requestedType as ExpenseDocumentType
      : null;
    const repository = new PostgresExpenseCategoryRepository();
    const [expenses, categories] = await Promise.all([
      new PostgresExpenseRepository().listForUser({
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
        search,
        categoryId,
        documentType,
      }),
      repository.listForUser(
        ctx.params.organizationId,
        ctx.state.user!.id,
        true,
      ),
    ]);
    return page({ expenses, categories, search, categoryId, documentType });
  },
});

function dateLabel(value: string | null, fallback: Date): string {
  if (value) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
      timeZone: "UTC",
    });
  }
  return fallback.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" });
}

export default define.page<typeof handler>(({ data, params }) => {
  const root = `/o/${params.organizationId}/expenses`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Náklady · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p class="text-sm font-semibold text-[#277a4c]">Evidence výdajů</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">Náklady</h1>
            <p class="mt-2 text-sm text-[#667169]">
              Interní evidence dokladů, nikoli účetní zápisy.
            </p>
          </div>
          <div class="flex flex-wrap gap-3">
            <a
              href={`/o/${params.organizationId}/settings/expense-categories`}
              class="rounded-xl border border-[#bfc9c1] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#f7f9f7]"
            >
              Kategorie
            </a>
            <a
              href={root + "/new"}
              class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
            >
              Přidat náklad
            </a>
          </div>
        </div>

        <form
          method="get"
          class="mt-8 grid gap-3 rounded-2xl border border-[#dce2dc] bg-white p-4 sm:grid-cols-[1fr_190px_190px_auto] sm:items-center"
        >
          <label>
            <span class="sr-only">Hledat náklady</span>
            <input
              type="search"
              name="q"
              value={data.search}
              maxlength={200}
              placeholder="Dodavatel, číslo nebo popis…"
              class="w-full rounded-xl border border-[#cad2cb] px-4 py-2.5 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            />
          </label>
          <select
            name="type"
            aria-label="Typ dokladu"
            class="rounded-xl border border-[#cad2cb] bg-white px-3 py-2.5"
          >
            <option value="">Všechny typy</option>
            {EXPENSE_DOCUMENT_TYPES.map((type) => (
              <option value={type} selected={data.documentType === type}>
                {expenseDocumentTypeLabel(type)}
              </option>
            ))}
          </select>
          <select
            name="category"
            aria-label="Kategorie"
            class="rounded-xl border border-[#cad2cb] bg-white px-3 py-2.5"
          >
            <option value="">Všechny kategorie</option>
            {data.categories.map((category) => (
              <option
                value={category.id}
                selected={data.categoryId === category.id}
              >
                {category.name}
                {category.isActive ? "" : " · neaktivní"}
              </option>
            ))}
          </select>
          <button
            type="submit"
            class="rounded-xl border border-[#bfc9c1] px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f4f1]"
          >
            Filtrovat
          </button>
        </form>

        <div class="mt-5 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
          {data.expenses.map((expense) => (
            <a
              href={`${root}/${expense.id}`}
              class="grid gap-2 border-b border-[#e6eae6] px-5 py-4 last:border-b-0 hover:bg-[#f7f9f7] sm:grid-cols-[1fr_170px_150px_160px] sm:items-center"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate font-semibold">
                    {expense.supplierName}
                  </span>
                  <span class="rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-semibold text-[#277a4c]">
                    {expenseDocumentTypeLabel(expense.documentType)}
                  </span>
                </div>
                <p class="mt-1 truncate text-xs text-[#7a857d]">
                  {expense.description}
                </p>
              </div>
              <span class="text-sm text-[#667169]">
                {expense.categoryName ?? "Bez kategorie"}
              </span>
              <span class="text-sm text-[#667169]">
                {dateLabel(expense.issueDate, expense.createdAt)}
              </span>
              <span class="text-right font-semibold">
                {formatMoneyForDisplay(expense.totalAmount)} {expense.currency}
              </span>
            </a>
          ))}
          {data.expenses.length === 0 && (
            <div class="px-6 py-14 text-center">
              <p class="font-semibold">Žádné náklady</p>
              <p class="mt-2 text-sm text-[#667169]">
                {data.search || data.categoryId || data.documentType
                  ? "Zkuste upravit filtry."
                  : "Přidejte první přijatou fakturu, účtenku nebo jiný náklad."}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
});
