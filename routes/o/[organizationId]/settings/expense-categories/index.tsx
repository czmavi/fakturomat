import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type { ExpenseCategory } from "@/domain/expenses/types.ts";
import { PostgresExpenseCategoryRepository } from "@/repositories/expense_category_repository.ts";

interface PageData {
  categories: ExpenseCategory[];
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const categories = await new PostgresExpenseCategoryRepository()
      .listForUser(
        ctx.params.organizationId,
        ctx.state.user!.id,
        true,
      );
    return page({ categories });
  },
});

export default define.page<typeof handler>(({ data, params }) => {
  const root = `/o/${params.organizationId}/settings/expense-categories`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Kategorie nákladů · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-4xl">
        <a
          href={`/o/${params.organizationId}/settings`}
          class="text-sm font-semibold text-[#277a4c] hover:underline"
        >
          ← Zpět do nastavení
        </a>
        <div class="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-[#277a4c]">Náklady</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">
              Kategorie nákladů
            </h1>
            <p class="mt-2 text-sm text-[#667169]">
              Kategorie pomáhají třídit výdaje a lze podle nich filtrovat.
            </p>
          </div>
          <a
            href={root + "/new"}
            class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
          >
            Přidat kategorii
          </a>
        </div>

        <div class="mt-7 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
          {data.categories.map((category) => (
            <div class="flex items-center justify-between gap-4 border-b border-[#e7ebe7] px-5 py-4 last:border-b-0">
              <div class="min-w-0">
                <p class="truncate font-semibold">{category.name}</p>
                <p class="mt-1 text-xs text-[#758078]">
                  {category.isActive ? "Aktivní" : "Neaktivní"}
                </p>
              </div>
              <a
                href={`${root}/${category.id}/edit`}
                class="shrink-0 text-sm font-semibold text-[#277a4c] hover:underline"
              >
                Upravit
              </a>
            </div>
          ))}
          {data.categories.length === 0 && (
            <p class="px-5 py-8 text-center text-sm text-[#667169]">
              Zatím není vytvořená žádná kategorie.
            </p>
          )}
        </div>
      </div>
    </main>
  );
});
