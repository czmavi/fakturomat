import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { formatMoneyForDisplay } from "@/domain/invoices/money.ts";
import {
  INVOICE_STATUSES,
  type InvoiceStatus,
  invoiceStatusLabel,
  type InvoiceSummary,
} from "@/domain/invoices/types.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";

interface PageData {
  invoices: InvoiceSummary[];
  status: InvoiceStatus | null;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const requested = ctx.url.searchParams.get("status");
    const status = INVOICE_STATUSES.includes(requested as InvoiceStatus)
      ? requested as InvoiceStatus
      : null;
    const invoices = await new PostgresInvoiceRepository().listForUser({
      organizationId: ctx.params.organizationId,
      userId: ctx.state.user!.id,
      status,
    });
    return page({ invoices, status });
  },
});

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
    timeZone: "UTC",
  });
}

function badgeClass(status: InvoiceStatus): string {
  switch (status) {
    case "DRAFT":
      return "bg-[#ecefed] text-[#59645c]";
    case "ISSUED":
      return "bg-[#fff1cf] text-[#795a12]";
    case "PAID":
      return "bg-[#dff2e5] text-[#21643e]";
    case "CANCELLED":
      return "bg-[#f5e8e6] text-[#8b4a43]";
  }
}

export default define.page<typeof handler>(({ data, params }) => {
  const root = `/o/${params.organizationId}/invoices`;
  const filters: Array<[string, InvoiceStatus | null]> = [
    ["Všechny", null],
    ["Koncepty", "DRAFT"],
    ["Vystavené", "ISSUED"],
    ["Zaplacené", "PAID"],
    ["Stornované", "CANCELLED"],
  ];
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Faktury · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p class="text-sm font-semibold text-[#277a4c]">Prodej</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">Faktury</h1>
          </div>
          <a
            href={root + "/new"}
            class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
          >
            Nový koncept
          </a>
        </div>
        <nav class="mt-7 flex flex-wrap gap-2" aria-label="Filtrovat faktury">
          {filters.map(([label, status]) => (
            <a
              href={status ? `${root}?status=${status}` : root}
              aria-current={data.status === status ? "page" : undefined}
              class={`rounded-full px-3.5 py-2 text-sm font-medium ${
                data.status === status
                  ? "bg-[#183e2a] text-white"
                  : "border border-[#cbd3cc] bg-white hover:bg-[#f7f9f7]"
              }`}
            >
              {label}
            </a>
          ))}
        </nav>
        <div class="mt-5 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
          {data.invoices.map((invoice) => (
            <a
              href={`${root}/${invoice.id}`}
              class="grid gap-2 border-b border-[#e6eae6] px-5 py-4 last:border-b-0 hover:bg-[#f7f9f7] sm:grid-cols-[1fr_150px_170px_150px] sm:items-center"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate font-semibold">
                    {invoice.contactName}
                  </span>
                  <span
                    class={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      badgeClass(invoice.status)
                    }`}
                  >
                    {invoiceStatusLabel(invoice.status)}
                  </span>
                </div>
                <p class="mt-1 text-xs text-[#7a857d]">
                  {invoice.number ?? `Koncept · ${invoice.numberSequenceName}`}
                </p>
              </div>
              <span class="text-sm text-[#667169]">
                {dateLabel(invoice.issueDate)}
              </span>
              <span class="text-sm text-[#667169]">
                Splatnost {dateLabel(invoice.dueDate)}
              </span>
              <span class="text-right font-semibold">
                {formatMoneyForDisplay(invoice.total)} {invoice.currency}
              </span>
            </a>
          ))}
          {data.invoices.length === 0 && (
            <div class="px-6 py-14 text-center">
              <p class="font-semibold">Žádné faktury</p>
              <p class="mt-2 text-sm text-[#667169]">
                Vytvořte první koncept faktury bez DPH.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
});
