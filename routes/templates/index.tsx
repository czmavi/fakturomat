import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type { InvoiceTemplate } from "@/domain/invoices/template_types.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";

export const handler = define.handlers<{ templates: InvoiceTemplate[] }>({
  async GET() {
    return page({
      templates: await new PostgresInvoiceTemplateRepository().list(),
    });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <main class="px-5 py-10 lg:py-12">
    <Head>
      <title>Šablony faktur · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-6xl">
      <div class="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p class="text-sm font-semibold text-[#277a4c]">Globální knihovna</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight">
            Šablony faktur
          </h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-[#667169]">
            Šablony jsou společné pro celou instalaci. Jednotlivé subjekty si
            volí svou výchozí šablonu.
          </p>
        </div>
        <a
          href="/templates/new"
          class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
        >
          Nová šablona
        </a>
      </div>
      <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.templates.map((template) => (
          <a
            href={`/templates/${template.id}`}
            class="rounded-2xl border border-[#dce2dc] bg-white p-5 hover:border-[#aebbb1] hover:shadow-sm"
          >
            <div class="flex items-start justify-between gap-3">
              <h2 class="font-semibold">{template.name}</h2>
              <span class="rounded-full bg-[#edf3ee] px-2 py-1 text-xs font-semibold text-[#277a4c]">
                v{template.currentVersion}
              </span>
            </div>
            <p class="mt-3 line-clamp-2 text-sm leading-6 text-[#667169]">
              {template.description ?? "Bez popisu"}
            </p>
          </a>
        ))}
      </div>
    </div>
  </main>
));
