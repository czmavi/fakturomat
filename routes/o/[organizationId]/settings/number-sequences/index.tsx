import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import {
  formatInvoiceNumber,
  type InvoiceNumberSequence,
} from "@/domain/invoices/number_sequence_types.ts";
import { PostgresInvoiceNumberSequenceRepository } from "@/repositories/invoice_number_sequence_repository.ts";

interface PageData {
  sequences: InvoiceNumberSequence[];
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const sequences = await new PostgresInvoiceNumberSequenceRepository()
      .listForUser(ctx.params.organizationId, ctx.state.user!.id);
    return page({ sequences });
  },
});

export default define.page<typeof handler>(({ data, params }) => {
  const root = `/o/${params.organizationId}/settings/number-sequences`;
  const year = new Date().getFullYear();
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Číselné řady · Fakturomat</title>
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
            <p class="text-sm font-semibold text-[#277a4c]">Faktury</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">
              Číselné řady
            </h1>
            <p class="mt-2 text-sm text-[#667169]">
              Každá řada má samostatný čítač pro každý kalendářní rok.
            </p>
          </div>
          <a
            href={root + "/new"}
            class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
          >
            Přidat řadu
          </a>
        </div>
        <div class="mt-7 grid gap-4 sm:grid-cols-2">
          {data.sequences.map((sequence) => (
            <article
              class={`rounded-2xl border bg-white p-5 ${
                sequence.isActive
                  ? "border-[#dce2dc]"
                  : "border-[#e4e4e4] opacity-60"
              }`}
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="font-semibold">{sequence.name}</h2>
                  <p class="mt-2 font-mono text-sm text-[#59645c]">
                    {formatInvoiceNumber(sequence, year, 1n)}
                  </p>
                </div>
                {sequence.isDefault && (
                  <span class="rounded-full bg-[#dff2e5] px-2.5 py-1 text-xs font-semibold text-[#21643e]">
                    Výchozí
                  </span>
                )}
              </div>
              <p class="mt-4 text-xs text-[#758078]">
                {sequence.isActive ? "Aktivní" : "Neaktivní"} ·{" "}
                {sequence.padding} číslice pořadí
              </p>
              <a
                href={`${root}/${sequence.id}/edit`}
                class="mt-4 inline-block text-sm font-semibold text-[#277a4c] hover:underline"
              >
                Upravit řadu
              </a>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
});
