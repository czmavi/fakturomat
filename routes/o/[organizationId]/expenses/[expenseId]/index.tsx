import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type { ExpenseAttachment } from "@/domain/expenses/attachment.ts";
import type { ExpensePayment } from "@/domain/banking/types.ts";
import { formatBankAmountForDisplay } from "@/domain/banking/types.ts";
import type { Expense } from "@/domain/expenses/types.ts";
import { expenseDocumentTypeLabel } from "@/domain/expenses/types.ts";
import {
  formatMoneyForDisplay,
  formatMoneyFromMinorUnits,
  parseMoneyToMinorUnits,
} from "@/domain/invoices/money.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresExpenseAttachmentRepository } from "@/repositories/expense_attachment_repository.ts";
import { PostgresExpensePaymentRepository } from "@/repositories/expense_payment_repository.ts";
import { PostgresExpenseRepository } from "@/repositories/expense_repository.ts";

interface PageData {
  expense: Expense;
  attachments: ExpenseAttachment[];
  payments: ExpensePayment[];
  saved: boolean;
  attachmentUploaded: boolean;
  attachmentRemoved: boolean;
  attachmentError: boolean;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.expenseId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const [expense, attachments, payments] = await Promise.all([
      new PostgresExpenseRepository().findForUser(
        ctx.params.organizationId,
        ctx.params.expenseId,
        ctx.state.user!.id,
      ),
      new PostgresExpenseAttachmentRepository().listForExpenseForUser(
        ctx.params.organizationId,
        ctx.params.expenseId,
        ctx.state.user!.id,
      ),
      new PostgresExpensePaymentRepository().listForExpenseForUser(
        ctx.params.organizationId,
        ctx.params.expenseId,
        ctx.state.user!.id,
      ),
    ]);
    if (!expense) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      expense,
      attachments,
      payments,
      saved: ctx.url.searchParams.get("saved") === "1",
      attachmentUploaded:
        ctx.url.searchParams.get("attachment_uploaded") === "1",
      attachmentRemoved: ctx.url.searchParams.get("attachment_removed") === "1",
      attachmentError: ctx.url.searchParams.has("attachment_error"),
    });
  },
});

function dateLabel(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
    timeZone: "UTC",
  });
}

function DetailItem(props: { label: string; value: string | null }) {
  return (
    <div>
      <dt class="text-xs font-medium uppercase tracking-[0.08em] text-[#7a857d]">
        {props.label}
      </dt>
      <dd class="mt-1.5 text-[#263029]">{props.value ?? "—"}</dd>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default define.page<typeof handler>(({ data, params, state }) => {
  const expense = data.expense;
  const root = `/o/${params.organizationId}/expenses`;
  const vatBase = parseMoneyToMinorUnits(expense.vatBaseTotal);
  const vatAmount = parseMoneyToMinorUnits(expense.vatAmountTotal);
  const difference = vatBase + vatAmount -
    parseMoneyToMinorUnits(expense.totalAmount);
  const displayDifference = formatMoneyForDisplay(
    formatMoneyFromMinorUnits(difference < 0n ? -difference : difference),
  );
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>{expense.supplierName} · Náklady · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-4xl">
        <a
          href={root}
          class="text-sm font-semibold text-[#277a4c] hover:underline"
        >
          ← Zpět na náklady
        </a>
        {data.saved && (
          <div
            role="status"
            class="mt-5 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Náklad byl uložen.
          </div>
        )}
        {(data.attachmentUploaded || data.attachmentRemoved) && (
          <div
            role="status"
            class="mt-5 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            {data.attachmentUploaded
              ? "Příloha byla bezpečně uložena."
              : "Příloha byla odstraněna."}
          </div>
        )}
        {data.attachmentError && (
          <div
            role="alert"
            class="mt-5 rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
          >
            Příloha musí být neprázdný PDF, JPG, JPEG nebo PNG soubor do 20 MB a
            její obsah musí odpovídat typu souboru.
          </div>
        )}
        <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-semibold text-[#277a4c]">
                  {expenseDocumentTypeLabel(expense.documentType)}
                </span>
                {expense.categoryName && (
                  <span class="rounded-full bg-[#ecefed] px-2.5 py-1 text-xs text-[#59645c]">
                    {expense.categoryName}
                  </span>
                )}
              </div>
              <h1 class="mt-3 text-3xl font-semibold tracking-tight">
                {expense.supplierName}
              </h1>
              <p class="mt-2 text-sm text-[#667169]">
                {expense.supplierInvoiceNumber
                  ? `Doklad ${expense.supplierInvoiceNumber}`
                  : "Bez čísla dokladu"}
              </p>
            </div>
            <a
              href={`${root}/${expense.id}/edit`}
              class="rounded-xl border border-[#bfc9c1] px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f4f1]"
            >
              Upravit
            </a>
          </div>

          <div class="mt-8 rounded-xl bg-[#183e2a] px-5 py-4 text-white">
            <span class="text-xs text-white/70">Celková částka</span>
            <p class="mt-1 text-2xl font-semibold">
              {formatMoneyForDisplay(expense.totalAmount)} {expense.currency}
            </p>
          </div>

          <dl class="mt-8 grid gap-x-8 gap-y-6 border-t border-[#e3e7e3] pt-7 sm:grid-cols-2">
            <DetailItem label="Kontakt" value={expense.contactName} />
            <DetailItem label="Kategorie" value={expense.categoryName} />
            <DetailItem
              label="Datum vystavení"
              value={dateLabel(expense.issueDate)}
            />
            <DetailItem
              label="Datum plnění"
              value={dateLabel(expense.taxableSupplyDate)}
            />
            <DetailItem
              label="Datum splatnosti"
              value={dateLabel(expense.dueDate)}
            />
            <DetailItem
              label="Datum úhrady"
              value={dateLabel(expense.paymentDate)}
            />
          </dl>

          <div class="mt-8 border-t border-[#e3e7e3] pt-7">
            <div class="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold">Rozpis DPH</h2>
                <p class="mt-1 text-sm text-[#667169]">
                  Evidenční hodnoty opsané z přijatého dokladu.
                </p>
              </div>
              <div class="flex gap-5 text-right text-sm">
                <div>
                  <span class="block text-xs text-[#758078]">
                    Součet základů
                  </span>
                  <strong>
                    {formatMoneyForDisplay(expense.vatBaseTotal)}{" "}
                    {expense.currency}
                  </strong>
                </div>
                <div>
                  <span class="block text-xs text-[#758078]">Součet DPH</span>
                  <strong>
                    {formatMoneyForDisplay(expense.vatAmountTotal)}{" "}
                    {expense.currency}
                  </strong>
                </div>
              </div>
            </div>

            {expense.vatLines.length > 0
              ? (
                <div class="mt-4 overflow-hidden rounded-xl border border-[#e0e5e1]">
                  {expense.vatLines.map((line) => (
                    <div class="grid grid-cols-[1fr_1fr_1fr] gap-3 border-b border-[#e7ebe7] px-4 py-3 text-sm last:border-b-0">
                      <span>{line.vatRate} %</span>
                      <span class="text-right">
                        Základ {formatMoneyForDisplay(line.baseAmount)}{" "}
                        {expense.currency}
                      </span>
                      <span class="text-right">
                        DPH {formatMoneyForDisplay(line.vatAmount)}{" "}
                        {expense.currency}
                      </span>
                    </div>
                  ))}
                </div>
              )
              : (
                <p class="mt-4 rounded-xl border border-dashed border-[#cbd3cc] px-4 py-5 text-center text-sm text-[#667169]">
                  Doklad nemá zadaný rozpis DPH.
                </p>
              )}

            {expense.vatLines.length > 0 && difference !== 0n && (
              <div
                role="status"
                class="mt-4 rounded-xl border border-[#ead39f] bg-[#fff9e9] px-4 py-3 text-sm text-[#775817]"
              >
                Součet základů a DPH se od celkové částky liší o{" "}
                {displayDifference} {expense.currency}.
              </div>
            )}
          </div>

          <div class="mt-7 border-t border-[#e3e7e3] pt-7">
            <h2 class="text-sm font-semibold">Popis</h2>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#5f6a62]">
              {expense.description}
            </p>
          </div>
          {expense.note && (
            <div class="mt-7 border-t border-[#e3e7e3] pt-7">
              <h2 class="text-sm font-semibold">Poznámka</h2>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#5f6a62]">
                {expense.note}
              </p>
            </div>
          )}

          {data.payments.length > 0 && (
            <div class="mt-7 border-t border-[#e3e7e3] pt-7">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold">Spárované úhrady</h2>
                  <p class="mt-1 text-sm text-[#667169]">
                    Ručně přiřazené odchozí bankovní pohyby.
                  </p>
                </div>
                <a
                  href={`/o/${params.organizationId}/banking`}
                  class="text-sm font-semibold text-[#277a4c] hover:underline"
                >
                  Spravovat párování
                </a>
              </div>
              <ul class="mt-4 space-y-2 text-sm">
                {data.payments.map((payment) => (
                  <li class="flex justify-between gap-4 rounded-lg bg-[#f4f1ea] px-3 py-2">
                    <span>Bankovní pohyb</span>
                    <strong>
                      {formatBankAmountForDisplay(payment.amount, false)}{" "}
                      {expense.currency}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div class="mt-7 border-t border-[#e3e7e3] pt-7">
            <div>
              <h2 class="text-lg font-semibold">Přílohy dokladu</h2>
              <p class="mt-1 text-sm text-[#667169]">
                PDF a obrázky JPG, JPEG nebo PNG do velikosti 20 MB.
              </p>
            </div>

            <form
              method="post"
              action={`${root}/${expense.id}/attachments`}
              enctype="multipart/form-data"
              class="mt-4 flex flex-col gap-3 rounded-xl bg-[#f5f7f5] p-4 sm:flex-row sm:items-center"
            >
              <input
                type="hidden"
                name="csrf_token"
                value={state.csrfToken}
              />
              <input
                type="file"
                name="attachment"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                required
                class="min-w-0 flex-1 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:font-semibold"
              />
              <button
                type="submit"
                class="shrink-0 rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
              >
                Nahrát přílohu
              </button>
            </form>

            <div class="mt-4 overflow-hidden rounded-xl border border-[#e0e5e1]">
              {data.attachments.map((attachment) => {
                const attachmentUrl =
                  `${root}/${expense.id}/attachments/${attachment.id}`;
                return (
                  <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#e7ebe7] px-4 py-3 last:border-b-0">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold">
                        {attachment.filename}
                      </p>
                      <p class="mt-1 text-xs text-[#758078]">
                        {attachment.mimeType} · {formatBytes(attachment.size)}
                      </p>
                    </div>
                    <div class="flex items-center gap-3">
                      <a
                        href={attachmentUrl}
                        target="_blank"
                        rel="noopener"
                        class="text-sm font-semibold text-[#277a4c] hover:underline"
                      >
                        Zobrazit
                      </a>
                      <a
                        href={attachmentUrl + "?download=1"}
                        class="text-sm font-semibold text-[#277a4c] hover:underline"
                      >
                        Stáhnout
                      </a>
                      <form
                        method="post"
                        action={attachmentUrl + "/delete"}
                      >
                        <input
                          type="hidden"
                          name="csrf_token"
                          value={state.csrfToken}
                        />
                        <button
                          type="submit"
                          class="text-sm font-semibold text-[#962f25] hover:underline"
                        >
                          Odstranit
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
              {data.attachments.length === 0 && (
                <p class="px-4 py-6 text-center text-sm text-[#667169]">
                  Zatím není nahraná žádná příloha.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
});
