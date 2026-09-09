import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { formatMoneyForDisplay } from "@/domain/invoices/money.ts";
import { type Invoice, invoiceStatusLabel } from "@/domain/invoices/types.ts";
import type { InvoicePayment } from "@/domain/banking/types.ts";
import { formatBankAmountForDisplay } from "@/domain/banking/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceRepository } from "@/repositories/invoice_repository.ts";
import { PostgresInvoiceDocumentRepository } from "@/repositories/invoice_document_repository.ts";
import { PostgresInvoicePaymentRepository } from "@/repositories/invoice_payment_repository.ts";

interface PageData {
  invoice: Invoice;
  issued: boolean;
  issueError: string | null;
  hasPdf: boolean;
  payments: InvoicePayment[];
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.invoiceId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const invoice = await new PostgresInvoiceRepository().findForUser(
      ctx.params.organizationId,
      ctx.params.invoiceId,
      ctx.state.user!.id,
    );
    if (!invoice) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const [document, payments] = await Promise.all([
      new PostgresInvoiceDocumentRepository().findPdfForUser(
        ctx.params.organizationId,
        ctx.params.invoiceId,
        ctx.state.user!.id,
      ),
      new PostgresInvoicePaymentRepository().listForInvoiceForUser(
        ctx.params.organizationId,
        ctx.params.invoiceId,
        ctx.state.user!.id,
      ),
    ]);
    return page({
      invoice,
      issued: ctx.url.searchParams.get("issued") === "1",
      issueError: ctx.url.searchParams.get("issue_error"),
      hasPdf: document !== null,
      payments,
    });
  },
});

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
    timeZone: "UTC",
  });
}

function addressLabel(snapshot: {
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
}): string {
  return [
    snapshot.street,
    [snapshot.postalCode, snapshot.city].filter(Boolean).join(" "),
    snapshot.country,
  ].filter(Boolean).join(", ");
}

function accountLabel(invoice: Invoice): string {
  const account = invoice.bankAccountSnapshot;
  if (!account) return "—";
  if (account.accountNumber && account.bankCode) {
    const prefix = account.accountPrefix ? `${account.accountPrefix}-` : "";
    return `${prefix}${account.accountNumber}/${account.bankCode}`;
  }
  return account.iban ?? "—";
}

export default define.page<typeof handler>(({ data, params, state }) => {
  const invoice = data.invoice;
  const root = `/o/${params.organizationId}/invoices`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>{invoice.number ?? "Koncept faktury"} · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-5xl">
        <a
          href={root}
          class="text-sm font-semibold text-[#277a4c] hover:underline"
        >
          ← Zpět na faktury
        </a>
        <div class="mt-5 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div class="flex items-center gap-3">
              <p class="text-sm font-semibold text-[#277a4c]">
                {invoiceStatusLabel(invoice.status)}
              </p>
              <span class="rounded-full bg-[#ecefed] px-2.5 py-1 text-xs text-[#59645c]">
                Bez DPH
              </span>
            </div>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">
              {invoice.number ?? "Koncept faktury"}
            </h1>
            <p class="mt-2 text-[#667169]">
              Odběratel:{" "}
              <strong class="text-[#263029]">{invoice.contactName}</strong>
            </p>
          </div>
          {invoice.status === "DRAFT" && (
            <div class="flex flex-wrap gap-3">
              <a
                href={`${root}/${invoice.id}/edit`}
                class="rounded-xl border border-[#bfc9c1] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#f7f9f7]"
              >
                Upravit koncept
              </a>
              <form method="post" action={`${root}/${invoice.id}/issue`}>
                <input
                  type="hidden"
                  name="csrf_token"
                  value={state.csrfToken}
                />
                <button
                  type="submit"
                  class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
                >
                  Vystavit fakturu
                </button>
              </form>
            </div>
          )}
          {invoice.status !== "DRAFT" && data.hasPdf && (
            <div class="flex flex-wrap gap-3">
              <a
                href={`${root}/${invoice.id}/document.pdf`}
                target="_blank"
                rel="noopener"
                class="rounded-xl border border-[#bfc9c1] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#f7f9f7]"
              >
                Zobrazit PDF
              </a>
              <a
                href={`${root}/${invoice.id}/document.pdf?download=1`}
                class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
              >
                Stáhnout PDF
              </a>
            </div>
          )}
        </div>

        {data.issued && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Faktura byla vystavena, PDF bylo bezpečně uloženo a údaje jsou nyní
            uzamčené.
          </div>
        )}
        {data.issueError && (
          <div
            role="alert"
            class="mt-6 rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
          >
            {data.issueError === "bank_account"
              ? "Před vystavením vyberte bankovní účet."
              : data.issueError === "currency"
              ? "Měna bankovního účtu se neshoduje s měnou faktury."
              : data.issueError === "reference"
              ? "Některý z vybraných údajů už není aktivní. Upravte koncept."
              : data.issueError === "qr_payment"
              ? "Pro vybraný účet nebo částku nelze vytvořit platnou QR Platbu. Upravte koncept."
              : data.issueError === "pdf"
              ? "PDF se nepodařilo vygenerovat. Faktura zůstala konceptem; zkontrolujte konfiguraci Chromia a zkuste to znovu."
              : "Fakturu už nelze vystavit jako koncept."}
          </div>
        )}

        <section class="mt-7 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
          <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt class="text-xs text-[#758078]">Datum vystavení</dt>
              <dd class="mt-1 font-semibold">{dateLabel(invoice.issueDate)}</dd>
            </div>
            <div>
              <dt class="text-xs text-[#758078]">Datum splatnosti</dt>
              <dd class="mt-1 font-semibold">{dateLabel(invoice.dueDate)}</dd>
            </div>
            <div>
              <dt class="text-xs text-[#758078]">Variabilní symbol</dt>
              <dd class="mt-1 font-semibold">
                {invoice.variableSymbol ?? "Doplní se při vystavení"}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-[#758078]">Číselná řada</dt>
              <dd class="mt-1 font-semibold">{invoice.numberSequenceName}</dd>
            </div>
            <div>
              <dt class="text-xs text-[#758078]">Bankovní účet</dt>
              <dd class="mt-1 font-semibold">
                {invoice.bankAccountName ?? "Bez účtu"}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-[#758078]">Šablona</dt>
              <dd class="mt-1 font-semibold">
                {invoice.invoiceTemplateName}
                {invoice.templateVersionNumber !== null
                  ? ` · v${invoice.templateVersionNumber}`
                  : ""}
              </dd>
            </div>
          </dl>

          {invoice.status === "DRAFT" && (
            <p class="mt-5 rounded-xl bg-[#fff8e7] px-4 py-3 text-sm text-[#765814]">
              Vystavení je nevratné. Zkontrolujte odběratele, účet, částky a
              splatnost; následně se uloží jejich aktuální snapshot.
            </p>
          )}

          {invoice.supplierSnapshot && invoice.customerSnapshot && (
            <div class="mt-8 grid gap-5 border-t border-[#e3e7e3] pt-7 sm:grid-cols-2">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wider text-[#277a4c]">
                  Dodavatel při vystavení
                </p>
                <h2 class="mt-2 font-semibold">
                  {invoice.supplierSnapshot.officialName}
                </h2>
                <p class="mt-1 text-sm text-[#667169]">
                  {addressLabel(invoice.supplierSnapshot)}
                </p>
                <p class="mt-1 text-sm text-[#667169]">
                  IČO {invoice.supplierSnapshot.ico ?? "—"} · DIČ{" "}
                  {invoice.supplierSnapshot.dic ?? "—"}
                </p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase tracking-wider text-[#277a4c]">
                  Odběratel při vystavení
                </p>
                <h2 class="mt-2 font-semibold">
                  {invoice.customerSnapshot.name}
                </h2>
                <p class="mt-1 text-sm text-[#667169]">
                  {addressLabel(invoice.customerSnapshot)}
                </p>
                <p class="mt-1 text-sm text-[#667169]">
                  IČO {invoice.customerSnapshot.ico ?? "—"} · DIČ{" "}
                  {invoice.customerSnapshot.dic ?? "—"}
                </p>
              </div>
            </div>
          )}

          {invoice.bankAccountSnapshot && (
            <div class="mt-6 grid gap-4 rounded-xl bg-[#f3f6f3] px-4 py-4 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <span class="text-xs text-[#758078]">
                  Platební účet při vystavení
                </span>
                <p class="mt-1 font-semibold">
                  {invoice.bankAccountSnapshot.name} · {accountLabel(invoice)}
                </p>
                {invoice.bankAccountSnapshot.iban && (
                  <p class="mt-1 font-mono text-xs text-[#667169]">
                    IBAN {invoice.bankAccountSnapshot.iban}
                  </p>
                )}
                <p class="mt-3 text-xs text-[#667169]">
                  QR Platba · {formatMoneyForDisplay(invoice.total)}{" "}
                  {invoice.currency} · VS {invoice.variableSymbol}
                </p>
              </div>
              <img
                src={`${root}/${invoice.id}/qr.svg`}
                width="160"
                height="160"
                alt={`QR Platba k faktuře ${invoice.number}`}
                class="rounded-lg bg-white"
              />
            </div>
          )}

          <div class="mt-8 overflow-x-auto">
            <table class="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr class="border-b border-[#cbd3cc] text-left text-xs text-[#667169]">
                  <th class="px-2 py-3">Popis</th>
                  <th class="px-2 py-3 text-right">Množství</th>
                  <th class="px-2 py-3">Jednotka</th>
                  <th class="px-2 py-3 text-right">Cena</th>
                  <th class="px-2 py-3 text-right">Celkem</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr class="border-b border-[#e6eae6]">
                    <td class="px-2 py-4 font-medium">{item.description}</td>
                    <td class="px-2 py-4 text-right">{item.quantity}</td>
                    <td class="px-2 py-4">{item.unit}</td>
                    <td class="px-2 py-4 text-right">
                      {formatMoneyForDisplay(item.unitPrice)} {invoice.currency}
                    </td>
                    <td class="px-2 py-4 text-right font-semibold">
                      {formatMoneyForDisplay(item.total)} {invoice.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="mt-6 flex justify-end">
            <div class="min-w-72 rounded-xl bg-[#183e2a] px-5 py-4 text-white">
              <span class="text-xs text-white/70">Celkem k úhradě</span>
              <p class="mt-1 text-2xl font-semibold">
                {formatMoneyForDisplay(invoice.total)} {invoice.currency}
              </p>
            </div>
          </div>
          {invoice.note && (
            <div class="mt-7 border-t border-[#e3e7e3] pt-5">
              <p class="text-xs text-[#758078]">Poznámka</p>
              <p class="mt-2 whitespace-pre-wrap text-sm">{invoice.note}</p>
            </div>
          )}
          {data.payments.length > 0 && (
            <div class="mt-7 border-t border-[#e3e7e3] pt-5">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs text-[#758078]">Přijaté platby</p>
                  <p class="mt-1 text-sm font-semibold">
                    {data.payments.length === 1
                      ? "1 spárovaný bankovní pohyb"
                      : `${data.payments.length} spárované bankovní pohyby`}
                  </p>
                </div>
                <a
                  href={`/o/${params.organizationId}/banking`}
                  class="text-sm font-semibold text-[#277a4c] hover:underline"
                >
                  Spravovat párování
                </a>
              </div>
              <ul class="mt-3 space-y-2 text-sm">
                {data.payments.map((payment) => (
                  <li class="flex justify-between gap-4 rounded-lg bg-[#eff6f1] px-3 py-2">
                    <span>
                      {payment.matchType === "AUTO"
                        ? "Automatická shoda"
                        : "Ruční shoda"}
                    </span>
                    <strong>
                      {formatBankAmountForDisplay(payment.amount, false)}{" "}
                      {invoice.currency}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
});
