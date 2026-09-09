import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { formatBankAmountForDisplay } from "@/domain/banking/types.ts";
import type {
  CurrencyAmount,
  DashboardOverview,
  DashboardPeriod,
  DashboardPeriodPreset,
} from "@/domain/dashboard/types.ts";
import { PostgresDashboardRepository } from "@/repositories/dashboard_repository.ts";
import {
  currentPragueDate,
  resolveDashboardPeriod,
} from "@/services/dashboard_period_service.ts";

interface PageData {
  overview: DashboardOverview;
  period: DashboardPeriod;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const period = resolveDashboardPeriod(ctx.url.searchParams);
    const overview = await new PostgresDashboardRepository().getForUser({
      organizationId: ctx.params.organizationId,
      userId: ctx.state.user!.id,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      today: currentPragueDate(),
    });
    if (overview === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({ overview, period });
  },
});

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
    timeZone: "UTC",
  });
}

function periodLabel(period: DashboardPeriod): string {
  switch (period.preset) {
    case "THIS_MONTH":
      return "Tento měsíc";
    case "LAST_MONTH":
      return "Minulý měsíc";
    case "THIS_YEAR":
      return "Tento rok";
    case "CUSTOM":
      return `${dateLabel(period.dateFrom)}–${dateLabel(period.dateTo)}`;
  }
}

function periodUrl(preset: DashboardPeriodPreset): string {
  return `?period=${preset}`;
}

function Amounts(props: {
  values: CurrencyAmount[];
  signed?: boolean;
  emptyLabel?: string;
}) {
  if (props.values.length === 0) {
    return (
      <p class="mt-3 text-2xl font-semibold text-[#8a948d]">
        {props.emptyLabel ?? "—"}
      </p>
    );
  }
  return (
    <div class="mt-3 space-y-1">
      {props.values.map((value) => (
        <p class="text-2xl font-semibold tracking-tight text-[#18211c]">
          {formatBankAmountForDisplay(value.amount, props.signed ?? false)}{" "}
          <span class="text-base font-medium text-[#667169]">
            {value.currency}
          </span>
        </p>
      ))}
    </div>
  );
}

function MetricCard(props: {
  label: string;
  hint: string;
  values: CurrencyAmount[];
  count?: number;
  signed?: boolean;
  href: string;
}) {
  return (
    <a
      href={props.href}
      class="group rounded-2xl border border-[#dce2dc] bg-white p-5 transition hover:border-[#aebbb1] hover:shadow-sm"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-[#263029]">{props.label}</p>
          <p class="mt-1 text-xs text-[#7a857d]">{props.hint}</p>
        </div>
        <span class="text-[#8a948d] transition group-hover:translate-x-0.5 group-hover:text-[#277a4c]">
          →
        </span>
      </div>
      <Amounts values={props.values} signed={props.signed} />
      {props.count !== undefined && (
        <p class="mt-3 text-xs font-medium text-[#667169]">
          {props.count} {props.count === 1 ? "záznam" : "záznamů"}
        </p>
      )}
    </a>
  );
}

export default define.page<typeof handler>(({ data, state, params }) => {
  const organization = state.currentOrganization;
  if (organization === null) return null;
  const root = `/o/${params.organizationId}`;
  const { overview, period } = data;

  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>{organization.displayName} · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p class="text-sm font-semibold text-[#277a4c]">Přehled subjektu</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight text-[#18211c]">
              {organization.displayName}
            </h1>
            <p class="mt-2 text-sm text-[#667169]">
              Provozní přehled za období {periodLabel(period).toLocaleLowerCase(
                "cs-CZ",
              )}.
            </p>
          </div>
          <div class="flex gap-2">
            <a
              href={`${root}/invoices/new`}
              class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
            >
              Nová faktura
            </a>
            <a
              href={`${root}/expenses/new`}
              class="rounded-xl border border-[#bfc9c1] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f4f1]"
            >
              Nový náklad
            </a>
          </div>
        </div>

        <section class="mt-8 rounded-2xl border border-[#dce2dc] bg-white p-4">
          <div class="flex flex-wrap items-center gap-2">
            {([
              ["THIS_MONTH", "Tento měsíc"],
              ["LAST_MONTH", "Minulý měsíc"],
              ["THIS_YEAR", "Tento rok"],
            ] as const).map(([preset, label]) => (
              <a
                href={periodUrl(preset)}
                aria-current={period.preset === preset ? "page" : undefined}
                class={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  period.preset === preset
                    ? "bg-[#183e2a] text-white"
                    : "text-[#59645c] hover:bg-[#f1f4f1]"
                }`}
              >
                {label}
              </a>
            ))}
            <form
              method="get"
              class="ml-auto flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="period" value="CUSTOM" />
              <input
                type="date"
                name="from"
                value={period.dateFrom}
                aria-label="Vlastní období od"
                required
                class="rounded-lg border border-[#cad2cb] px-3 py-2 text-sm"
              />
              <span class="text-sm text-[#7a857d]">až</span>
              <input
                type="date"
                name="to"
                value={period.dateTo}
                aria-label="Vlastní období do"
                required
                class="rounded-lg border border-[#cad2cb] px-3 py-2 text-sm"
              />
              <button
                type="submit"
                class={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                  period.preset === "CUSTOM"
                    ? "border-[#183e2a] bg-[#edf3ee] text-[#183e2a]"
                    : "border-[#bfc9c1] hover:bg-[#f1f4f1]"
                }`}
              >
                Vlastní období
              </button>
            </form>
          </div>
        </section>

        <section class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Vydané faktury"
            hint={periodLabel(period)}
            values={overview.issuedInvoiceTotals}
            count={overview.issuedInvoiceCount}
            href={`${root}/invoices`}
          />
          <MetricCard
            label="Příjmy"
            hint={`Příchozí pohyby · ${periodLabel(period)}`}
            values={overview.incomeTotals}
            href={`${root}/banking?direction=INCOMING&from=${period.dateFrom}&to=${period.dateTo}`}
          />
          <MetricCard
            label="Náklady"
            hint={`Doklady v evidenci · ${periodLabel(period)}`}
            values={overview.expenseTotals}
            href={`${root}/expenses`}
          />
          <MetricCard
            label="Cashflow"
            hint={`Čisté bankovní pohyby · ${periodLabel(period)}`}
            values={overview.cashflowTotals}
            signed
            href={`${root}/banking?from=${period.dateFrom}&to=${period.dateTo}`}
          />
        </section>

        <section class="mt-8 grid gap-4 lg:grid-cols-3">
          <article class="rounded-2xl border border-[#dce2dc] bg-white p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">Nezaplacené faktury</p>
                <p class="mt-1 text-xs text-[#7a857d]">
                  Aktuální zbývající částky
                </p>
              </div>
              <span class="rounded-full bg-[#fff4d8] px-2.5 py-1 text-xs font-semibold text-[#765814]">
                {overview.unpaidInvoiceCount}
              </span>
            </div>
            <Amounts values={overview.unpaidInvoiceTotals} />
            <a
              href={`${root}/invoices?status=ISSUED`}
              class="mt-4 inline-block text-sm font-semibold text-[#277a4c] hover:underline"
            >
              Zobrazit nezaplacené →
            </a>
          </article>

          <article class="rounded-2xl border border-[#e8d5ce] bg-[#fffaf8] p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">Po splatnosti</p>
                <p class="mt-1 text-xs text-[#8a736b]">
                  Neuhrazené k dnešnímu dni
                </p>
              </div>
              <span class="rounded-full bg-[#f9e2dc] px-2.5 py-1 text-xs font-semibold text-[#962f25]">
                {overview.overdueInvoiceCount}
              </span>
            </div>
            <Amounts values={overview.overdueInvoiceTotals} />
            <a
              href={`${root}/invoices?status=ISSUED`}
              class="mt-4 inline-block text-sm font-semibold text-[#962f25] hover:underline"
            >
              Zkontrolovat faktury →
            </a>
          </article>

          <article class="rounded-2xl border border-[#dce2dc] bg-white p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">Nespárované pohyby</p>
                <p class="mt-1 text-xs text-[#7a857d]">
                  Zbývající částka v období
                </p>
              </div>
              <span class="rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-semibold text-[#277a4c]">
                {overview.unmatchedTransactionCount}
              </span>
            </div>
            <div class="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div class="rounded-xl bg-[#f5f7f5] p-3">
                <span class="block text-xs text-[#7a857d]">Příchozí</span>
                <strong class="mt-1 block text-xl">
                  {overview.unmatchedIncomingCount}
                </strong>
              </div>
              <div class="rounded-xl bg-[#f5f7f5] p-3">
                <span class="block text-xs text-[#7a857d]">Odchozí</span>
                <strong class="mt-1 block text-xl">
                  {overview.unmatchedOutgoingCount}
                </strong>
              </div>
            </div>
            <a
              href={`${root}/banking?from=${period.dateFrom}&to=${period.dateTo}`}
              class="mt-4 inline-block text-sm font-semibold text-[#277a4c] hover:underline"
            >
              Spravovat párování →
            </a>
          </article>
        </section>

        <section class="mt-8">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-[#277a4c]">Banka</p>
              <h2 class="mt-1 text-2xl font-semibold">Aktuální zůstatky</h2>
            </div>
            <a
              href={`${root}/banking`}
              class="text-sm font-semibold text-[#277a4c] hover:underline"
            >
              Otevřít bankovnictví →
            </a>
          </div>
          <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview.bankBalances.map((balance) => (
              <article class="rounded-2xl border border-[#dce2dc] bg-white p-5">
                <p class="text-sm font-semibold">{balance.bankAccountName}</p>
                <p class="mt-3 text-2xl font-semibold tracking-tight">
                  {formatBankAmountForDisplay(balance.amount, false)}{" "}
                  <span class="text-base font-medium text-[#667169]">
                    {balance.currency}
                  </span>
                </p>
                <p class="mt-2 text-xs text-[#7a857d]">
                  Stav k {dateLabel(balance.date)}
                </p>
              </article>
            ))}
            {overview.bankBalances.length === 0 && (
              <div class="rounded-2xl border border-dashed border-[#c9d0ca] px-5 py-8 text-center sm:col-span-2 lg:col-span-3">
                <p class="font-semibold">Zůstatek zatím není dostupný</p>
                <p class="mt-2 text-sm text-[#667169]">
                  Zobrazí se po první úspěšné synchronizaci připojeného účtu.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
});
