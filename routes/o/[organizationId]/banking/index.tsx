import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type {
  BankAccount,
  BankConnection,
  BankTransaction,
  BankTransactionDirection,
  ExpensePayment,
  InvoicePayment,
  PaymentExpenseCandidate,
  PaymentInvoiceCandidate,
} from "@/domain/banking/types.ts";
import {
  BANK_TRANSACTION_DIRECTIONS,
  bankConnectionStatusLabel,
  formatBankAccount,
  formatBankAmountForDisplay,
} from "@/domain/banking/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresBankConnectionRepository } from "@/repositories/bank_connection_repository.ts";
import { PostgresBankTransactionRepository } from "@/repositories/bank_transaction_repository.ts";
import { PostgresExpensePaymentRepository } from "@/repositories/expense_payment_repository.ts";
import { PostgresInvoicePaymentRepository } from "@/repositories/invoice_payment_repository.ts";
import {
  BankSyncError,
  createBankSyncService,
} from "@/services/banking/bank_sync_service.ts";
import {
  ExpensePaymentService,
  outgoingTransactionRemainingAmount,
  suggestExpensePayments,
} from "@/services/banking/expense_payment_service.ts";
import {
  InvoicePaymentService,
  suggestInvoicePayments,
  transactionRemainingAmount,
} from "@/services/banking/invoice_payment_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface ConnectedAccount {
  account: BankAccount;
  connection: BankConnection | null;
}

interface PageData {
  accounts: ConnectedAccount[];
  transactions: BankTransaction[];
  payments: InvoicePayment[];
  invoiceCandidates: PaymentInvoiceCandidate[];
  expensePayments: ExpensePayment[];
  expenseCandidates: PaymentExpenseCandidate[];
  accountId: string | null;
  direction: BankTransactionDirection;
  dateFrom: string | null;
  dateTo: string | null;
  syncDateFrom: string;
  syncDateTo: string;
  error: string | null;
  syncSummary:
    | { fetched: number; inserted: number; autoMatched: number }
    | null;
  matched: boolean;
  unmatched: boolean;
  expenseMatched: boolean;
  expenseUnmatched: boolean;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): value is string {
  if (value === null || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

function pragueToday(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function syncDefaults(): { dateFrom: string; dateTo: string } {
  const dateTo = pragueToday();
  return { dateFrom: shiftDate(dateTo, -29), dateTo };
}

async function loadPageData(input: {
  organizationId: string;
  userId: string;
  url: URL;
  error?: string | null;
  syncDateFrom?: string;
  syncDateTo?: string;
}): Promise<PageData> {
  const accountRepository = new PostgresBankAccountRepository();
  const connectionRepository = new PostgresBankConnectionRepository();
  const bankAccounts = await accountRepository.listForUser(
    input.organizationId,
    input.userId,
  );
  const accounts = await Promise.all(bankAccounts.map(async (account) => ({
    account,
    connection: await connectionRepository.findForUser(
      input.organizationId,
      account.id,
      input.userId,
    ),
  })));
  const requestedAccountId = input.url.searchParams.get("account");
  const accountId = requestedAccountId && isUuid(requestedAccountId) &&
      bankAccounts.some((account) => account.id === requestedAccountId)
    ? requestedAccountId
    : null;
  const requestedDirection = input.url.searchParams.get("direction");
  const direction = BANK_TRANSACTION_DIRECTIONS.includes(
      requestedDirection as BankTransactionDirection,
    )
    ? requestedDirection as BankTransactionDirection
    : "ALL";
  const requestedDateFrom = input.url.searchParams.get("from");
  const requestedDateTo = input.url.searchParams.get("to");
  const dateFrom = validDate(requestedDateFrom) ? requestedDateFrom : null;
  const dateTo = validDate(requestedDateTo) ? requestedDateTo : null;
  const transactions = await new PostgresBankTransactionRepository()
    .listForUser({
      organizationId: input.organizationId,
      userId: input.userId,
      bankAccountId: accountId,
      direction,
      dateFrom,
      dateTo,
    });
  const paymentRepository = new PostgresInvoicePaymentRepository();
  const expensePaymentRepository = new PostgresExpensePaymentRepository();
  const [payments, invoiceCandidates, expensePayments, expenseCandidates] =
    await Promise.all([
      paymentRepository.listForTransactionIdsForUser(
        input.organizationId,
        transactions.map((transaction) => transaction.id),
        input.userId,
      ),
      paymentRepository.listOpenInvoiceCandidatesForUser(
        input.organizationId,
        input.userId,
      ),
      expensePaymentRepository.listForTransactionIdsForUser(
        input.organizationId,
        transactions.map((transaction) => transaction.id),
        input.userId,
      ),
      expensePaymentRepository.listOpenExpenseCandidatesForUser(
        input.organizationId,
        input.userId,
      ),
    ]);
  const defaults = syncDefaults();
  const fetched = Number(input.url.searchParams.get("fetched"));
  const inserted = Number(input.url.searchParams.get("inserted"));
  const autoMatched = Number(input.url.searchParams.get("auto_matched"));
  const synced = input.url.searchParams.get("synced") === "1";
  return {
    accounts,
    transactions,
    payments,
    invoiceCandidates,
    expensePayments,
    expenseCandidates,
    accountId,
    direction,
    dateFrom,
    dateTo,
    syncDateFrom: input.syncDateFrom ?? defaults.dateFrom,
    syncDateTo: input.syncDateTo ?? defaults.dateTo,
    error: input.error ?? null,
    syncSummary: synced && Number.isSafeInteger(fetched) && fetched >= 0 &&
        Number.isSafeInteger(inserted) && inserted >= 0 &&
        Number.isSafeInteger(autoMatched) && autoMatched >= 0
      ? { fetched, inserted, autoMatched }
      : null,
    matched: input.url.searchParams.get("matched") === "1",
    unmatched: input.url.searchParams.get("unmatched") === "1",
    expenseMatched: input.url.searchParams.get("expense_matched") === "1",
    expenseUnmatched: input.url.searchParams.get("expense_unmatched") === "1",
  };
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    return page(
      await loadPageData({
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
        url: ctx.url,
      }),
    );
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const intent = String(form.get("intent") ?? "sync");
    const accountId = String(form.get("bank_account_id") ?? "");
    const dateFrom = String(form.get("date_from") ?? "");
    const dateTo = String(form.get("date_to") ?? "");
    const renderError = async (message: string, status: number) => {
      return page(
        await loadPageData({
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
          url: ctx.url,
          error: message,
          syncDateFrom: validDate(dateFrom) ? dateFrom : undefined,
          syncDateTo: validDate(dateTo) ? dateTo : undefined,
        }),
        { status },
      );
    };
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return await renderError(
        "Platnost formuláře vypršela. Zkuste to znovu.",
        403,
      );
    }
    const paymentService = new InvoicePaymentService(
      new PostgresInvoicePaymentRepository(),
    );
    if (intent === "manual_match") {
      const bankTransactionId = String(form.get("bank_transaction_id") ?? "");
      const invoiceId = String(form.get("invoice_id") ?? "");
      if (!isUuid(bankTransactionId) || !isUuid(invoiceId)) {
        return await renderError("Vybrané párování není platné.", 422);
      }
      const result = await paymentService.manualMatchForUser({
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
        bankTransactionId,
        invoiceId,
      });
      if (result.kind === "not_found") {
        return new Response("Pohyb nebo faktura nebyly nalezeny.", {
          status: 404,
        });
      }
      if (result.kind === "not_matchable") {
        return await renderError(
          "Pohyb už nelze přiřadit nebo se neshoduje měna.",
          422,
        );
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/banking?matched=1`,
        303,
      );
    }
    if (intent === "unmatch") {
      const paymentId = String(form.get("payment_id") ?? "");
      if (!isUuid(paymentId)) {
        return await renderError("Vybrané párování není platné.", 422);
      }
      if (
        !await paymentService.unmatchForUser({
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
          paymentId,
        })
      ) {
        return new Response("Párování nebylo nalezeno.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/banking?unmatched=1`,
        303,
      );
    }
    const expensePaymentService = new ExpensePaymentService(
      new PostgresExpensePaymentRepository(),
    );
    if (intent === "manual_expense_match") {
      const bankTransactionId = String(form.get("bank_transaction_id") ?? "");
      const expenseId = String(form.get("expense_id") ?? "");
      if (!isUuid(bankTransactionId) || !isUuid(expenseId)) {
        return await renderError("Vybrané párování není platné.", 422);
      }
      const result = await expensePaymentService.manualMatchForUser({
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
        bankTransactionId,
        expenseId,
      });
      if (result.kind === "not_found") {
        return new Response("Pohyb nebo náklad nebyly nalezeny.", {
          status: 404,
        });
      }
      if (result.kind === "not_matchable") {
        return await renderError(
          "Pohyb už nelze přiřadit nebo se neshoduje měna.",
          422,
        );
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/banking?expense_matched=1`,
        303,
      );
    }
    if (intent === "unmatch_expense") {
      const paymentId = String(form.get("payment_id") ?? "");
      if (!isUuid(paymentId)) {
        return await renderError("Vybrané párování není platné.", 422);
      }
      if (
        !await expensePaymentService.unmatchForUser({
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
          paymentId,
        })
      ) {
        return new Response("Párování nebylo nalezeno.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/banking?expense_unmatched=1`,
        303,
      );
    }
    if (!isUuid(accountId)) {
      return await renderError("Bankovní účet není platný.", 422);
    }
    try {
      const result = await createBankSyncService().sync({
        organizationId: ctx.params.organizationId,
        bankAccountId: accountId,
        userId: ctx.state.user!.id,
        dateFrom,
        dateTo,
      });
      if (result === null) {
        return new Response("Připojení nebylo nalezeno.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/banking?synced=1&fetched=${result.fetched}&inserted=${result.inserted}&auto_matched=${result.autoMatched}`,
        303,
      );
    } catch (error) {
      if (error instanceof BankSyncError) {
        return await renderError(
          error.message,
          error.kind === "PROVIDER" ? 502 : 422,
        );
      }
      throw error;
    }
  },
});

function dateLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("cs-CZ", {
    timeZone: "UTC",
  });
}

function counterparty(transaction: BankTransaction): string {
  if (transaction.counterpartyName) return transaction.counterpartyName;
  if (transaction.counterpartyAccount && transaction.counterpartyBankCode) {
    return `${transaction.counterpartyAccount}/${transaction.counterpartyBankCode}`;
  }
  return transaction.counterpartyAccount ?? "Neuvedená protistrana";
}

export default define.page<typeof handler>(({ data, state, params }) => {
  const root = `/o/${params.organizationId}`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Banka · {state.currentOrganization?.displayName}</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <p class="text-sm font-semibold text-[#277a4c]">
          Read-only bankovnictví
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Banka</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-[#667169]">
          Pohyby se načítají pouze na vyžádání. Aplikace nemá žádnou cestu pro
          vytváření platebních příkazů.
        </p>

        {data.syncSummary && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Synchronizace dokončena: načteno{" "}
            {data.syncSummary.fetched}, nově uloženo {data.syncSummary.inserted}
            {" "}
            pohybů a automaticky spárováno {data.syncSummary.autoMatched}{" "}
            plateb.
          </div>
        )}
        {data.matched && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Platba byla přiřazena k faktuře.
          </div>
        )}
        {data.unmatched && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#d8cfad] bg-[#fff9e9] px-4 py-3 text-sm text-[#765814]"
          >
            Párování bylo zrušeno a stav faktury přepočítán.
          </div>
        )}
        {data.expenseMatched && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Odchozí platba byla přiřazena k nákladu.
          </div>
        )}
        {data.expenseUnmatched && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#d8cfad] bg-[#fff9e9] px-4 py-3 text-sm text-[#765814]"
          >
            Párování odchozí platby s nákladem bylo zrušeno.
          </div>
        )}
        {data.error && (
          <div
            role="alert"
            class="mt-6 rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
          >
            {data.error}
          </div>
        )}

        <section class="mt-8 grid gap-4 lg:grid-cols-2">
          {data.accounts.map(({ account, connection }) => (
            <article class="rounded-2xl border border-[#dce2dc] bg-white p-5">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 class="font-semibold">{account.name}</h2>
                  <p class="mt-1 text-sm text-[#667169]">
                    {formatBankAccount(account)} · {account.currency}
                  </p>
                </div>
                <span class="rounded-full bg-[#edf3ee] px-3 py-1 text-xs font-semibold text-[#277a4c]">
                  {connection
                    ? bankConnectionStatusLabel(connection.status)
                    : "Bez připojení"}
                </span>
              </div>
              {connection?.currentBalance && connection.balanceCurrency && (
                <div class="mt-5">
                  <p class="text-xs uppercase tracking-wide text-[#7a857d]">
                    Zůstatek k {connection.balanceDate
                      ? dateLabel(connection.balanceDate)
                      : "—"}
                  </p>
                  <p class="mt-1 text-xl font-semibold">
                    {formatBankAmountForDisplay(
                      connection.currentBalance,
                      false,
                    )} {connection.balanceCurrency}
                  </p>
                </div>
              )}
              {connection && connection.status !== "DISABLED"
                ? (
                  <form method="post" class="mt-5 grid gap-3 sm:grid-cols-2">
                    <input
                      type="hidden"
                      name="csrf_token"
                      value={state.csrfToken}
                    />
                    <input type="hidden" name="intent" value="sync" />
                    <input
                      type="hidden"
                      name="bank_account_id"
                      value={account.id}
                    />
                    <label class="text-sm">
                      <span class="mb-1.5 block text-[#667169]">Od</span>
                      <input
                        type="date"
                        name="date_from"
                        value={data.syncDateFrom}
                        required
                        class="w-full rounded-xl border border-[#cad2cb] px-3 py-2.5"
                      />
                    </label>
                    <label class="text-sm">
                      <span class="mb-1.5 block text-[#667169]">Do</span>
                      <input
                        type="date"
                        name="date_to"
                        value={data.syncDateTo}
                        required
                        class="w-full rounded-xl border border-[#cad2cb] px-3 py-2.5"
                      />
                    </label>
                    <button
                      type="submit"
                      class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b] sm:col-span-2"
                    >
                      Synchronizovat nyní
                    </button>
                  </form>
                )
                : (
                  <a
                    href={`${root}/settings/bank-accounts/${account.id}/connection`}
                    class="mt-5 inline-block text-sm font-semibold text-[#277a4c] hover:underline"
                  >
                    {connection ? "Zapnout Fio připojení" : "Nastavit Fio API"}
                  </a>
                )}
            </article>
          ))}
          {data.accounts.length === 0 && (
            <div class="rounded-2xl border border-dashed border-[#c9d0ca] p-8 text-center lg:col-span-2">
              <p class="font-semibold">Nejdříve přidejte bankovní účet</p>
              <a
                href={root + "/settings/bank-accounts/new"}
                class="mt-2 inline-block text-sm font-semibold text-[#277a4c] hover:underline"
              >
                Přidat bankovní účet
              </a>
            </div>
          )}
        </section>

        <section class="mt-10">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-[#277a4c]">
                Importované pohyby
              </p>
              <h2 class="mt-1 text-2xl font-semibold">Transakce</h2>
            </div>
          </div>
          <form
            method="get"
            class="mt-5 grid gap-3 rounded-2xl border border-[#dce2dc] bg-white p-4 sm:grid-cols-2 xl:grid-cols-[1fr_170px_170px_170px_auto]"
          >
            <select
              name="account"
              aria-label="Bankovní účet"
              class="rounded-xl border border-[#cad2cb] bg-white px-3 py-2.5"
            >
              <option value="">Všechny účty</option>
              {data.accounts.map(({ account }) => (
                <option
                  value={account.id}
                  selected={data.accountId === account.id}
                >
                  {account.name}
                </option>
              ))}
            </select>
            <select
              name="direction"
              aria-label="Směr transakce"
              class="rounded-xl border border-[#cad2cb] bg-white px-3 py-2.5"
            >
              <option value="ALL" selected={data.direction === "ALL"}>
                Vše
              </option>
              <option value="INCOMING" selected={data.direction === "INCOMING"}>
                Příchozí
              </option>
              <option value="OUTGOING" selected={data.direction === "OUTGOING"}>
                Odchozí
              </option>
            </select>
            <input
              type="date"
              name="from"
              value={data.dateFrom ?? ""}
              aria-label="Pohyby od"
              class="rounded-xl border border-[#cad2cb] px-3 py-2.5"
            />
            <input
              type="date"
              name="to"
              value={data.dateTo ?? ""}
              aria-label="Pohyby do"
              class="rounded-xl border border-[#cad2cb] px-3 py-2.5"
            />
            <button
              type="submit"
              class="rounded-xl border border-[#bfc9c1] px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f4f1]"
            >
              Filtrovat
            </button>
          </form>

          <div class="mt-5 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
            {data.transactions.map((transaction) => {
              const transactionPayments = data.payments.filter((payment) =>
                payment.bankTransactionId === transaction.id
              );
              const suggestions = suggestInvoicePayments(
                transaction,
                transactionPayments,
                data.invoiceCandidates,
              );
              const suggestedIds = new Set(
                suggestions.map((suggestion) => suggestion.invoice.id),
              );
              const otherCandidates = data.invoiceCandidates.filter((invoice) =>
                invoice.currency === transaction.currency &&
                !suggestedIds.has(invoice.id)
              );
              const hasRemainingIncomingAmount =
                transactionRemainingAmount(transaction, transactionPayments) >
                  0n;
              const transactionExpensePayments = data.expensePayments.filter(
                (payment) => payment.bankTransactionId === transaction.id,
              );
              const expenseSuggestions = suggestExpensePayments(
                transaction,
                transactionExpensePayments,
                data.expenseCandidates,
              );
              const suggestedExpenseIds = new Set(
                expenseSuggestions.map((suggestion) => suggestion.expense.id),
              );
              const otherExpenseCandidates = data.expenseCandidates.filter(
                (expense) =>
                  expense.currency === transaction.currency &&
                  !suggestedExpenseIds.has(expense.id),
              );
              const hasRemainingOutgoingAmount = transaction.amount.startsWith(
                "-",
              ) &&
                outgoingTransactionRemainingAmount(
                    transaction,
                    transactionExpensePayments,
                  ) > 0n;
              return (
                <article class="border-b border-[#e6eae6] px-5 py-4 last:border-b-0">
                  <div class="grid gap-2 sm:grid-cols-[120px_1fr_170px] sm:items-center">
                    <div class="text-sm text-[#667169]">
                      <p>{dateLabel(transaction.bookingDate)}</p>
                      <p class="mt-1 text-xs">{transaction.bankAccountName}</p>
                    </div>
                    <div class="min-w-0">
                      <p class="truncate font-semibold">
                        {counterparty(transaction)}
                      </p>
                      <p class="mt-1 truncate text-xs text-[#7a857d]">
                        {transaction.message ?? "Bez zprávy"}
                        {transaction.variableSymbol
                          ? ` · VS ${transaction.variableSymbol}`
                          : ""}
                      </p>
                      {transactionPayments.length === 0 &&
                        transactionExpensePayments.length === 0 && (
                        <span class="mt-2 inline-block rounded-full bg-[#fff4d8] px-2.5 py-1 text-xs font-semibold text-[#765814]">
                          Nespárováno
                        </span>
                      )}
                    </div>
                    <p
                      class={`text-right font-semibold ${
                        transaction.amount.startsWith("-")
                          ? "text-[#962f25]"
                          : "text-[#21643e]"
                      }`}
                    >
                      {formatBankAmountForDisplay(transaction.amount)}{" "}
                      {transaction.currency}
                    </p>
                  </div>

                  {transactionPayments.length > 0 && (
                    <div class="mt-3 space-y-2 rounded-xl bg-[#eff6f1] p-3">
                      {transactionPayments.map((payment) => (
                        <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
                          <p>
                            <span class="font-semibold">
                              {payment.matchType === "AUTO"
                                ? "Automaticky spárováno"
                                : "Ručně spárováno"}
                            </span>{" "}
                            s{" "}
                            <a
                              href={`${root}/invoices/${payment.invoiceId}`}
                              class="font-semibold text-[#277a4c] hover:underline"
                            >
                              fakturou {payment.invoiceNumber}
                            </a>{" "}
                            ·{" "}
                            {formatBankAmountForDisplay(payment.amount, false)}
                            {" "}
                            {transaction.currency}
                          </p>
                          <form method="post">
                            <input
                              type="hidden"
                              name="csrf_token"
                              value={state.csrfToken}
                            />
                            <input
                              type="hidden"
                              name="intent"
                              value="unmatch"
                            />
                            <input
                              type="hidden"
                              name="payment_id"
                              value={payment.id}
                            />
                            <button
                              type="submit"
                              class="text-xs font-semibold text-[#962f25] hover:underline"
                            >
                              Zrušit párování
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  )}

                  {transactionExpensePayments.length > 0 && (
                    <div class="mt-3 space-y-2 rounded-xl bg-[#f4f1ea] p-3">
                      {transactionExpensePayments.map((payment) => (
                        <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
                          <p>
                            <span class="font-semibold">Ručně spárováno</span> s
                            {" "}
                            <a
                              href={`${root}/expenses/${payment.expenseId}`}
                              class="font-semibold text-[#277a4c] hover:underline"
                            >
                              nákladem {payment.expenseDocumentNumber ??
                                payment.expenseSupplierName}
                            </a>{" "}
                            ·{" "}
                            {formatBankAmountForDisplay(payment.amount, false)}
                            {" "}
                            {transaction.currency}
                          </p>
                          <form method="post">
                            <input
                              type="hidden"
                              name="csrf_token"
                              value={state.csrfToken}
                            />
                            <input
                              type="hidden"
                              name="intent"
                              value="unmatch_expense"
                            />
                            <input
                              type="hidden"
                              name="payment_id"
                              value={payment.id}
                            />
                            <button
                              type="submit"
                              class="text-xs font-semibold text-[#962f25] hover:underline"
                            >
                              Zrušit párování
                            </button>
                          </form>
                        </div>
                      ))}
                    </div>
                  )}

                  {!transaction.amount.startsWith("-") &&
                    hasRemainingIncomingAmount &&
                    (suggestions.length > 0 || otherCandidates.length > 0) && (
                    <form
                      method="post"
                      class="mt-3 grid gap-2 rounded-xl border border-[#dce2dc] bg-[#fafbfa] p-3 sm:grid-cols-[1fr_auto]"
                    >
                      <input
                        type="hidden"
                        name="csrf_token"
                        value={state.csrfToken}
                      />
                      <input
                        type="hidden"
                        name="intent"
                        value="manual_match"
                      />
                      <input
                        type="hidden"
                        name="bank_transaction_id"
                        value={transaction.id}
                      />
                      <label>
                        <span class="sr-only">Faktura pro ruční párování</span>
                        <select
                          name="invoice_id"
                          required
                          class="w-full rounded-lg border border-[#cad2cb] bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Vyberte fakturu…</option>
                          {suggestions.length > 0 && (
                            <optgroup label="Navržené shody">
                              {suggestions.map((suggestion) => (
                                <option value={suggestion.invoice.id}>
                                  {suggestion.invoice.number} ·{" "}
                                  {suggestion.invoice.contactName}
                                  {suggestion.variableSymbolMatches
                                    ? " · shodný VS"
                                    : ""}
                                  {suggestion.amountMatches
                                    ? " · shodná částka"
                                    : ""}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {otherCandidates.length > 0 && (
                            <optgroup label="Ostatní otevřené faktury ve stejné měně">
                              {otherCandidates.map((invoice) => (
                                <option value={invoice.id}>
                                  {invoice.number} · {invoice.contactName}{" "}
                                  · zbývá {formatBankAmountForDisplay(
                                    invoice.remainingAmount,
                                    false,
                                  )} {invoice.currency}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                      <button
                        type="submit"
                        class="rounded-lg border border-[#bfc9c1] bg-white px-4 py-2 text-sm font-semibold hover:bg-[#f1f4f1]"
                      >
                        Přiřadit
                      </button>
                    </form>
                  )}
                  {hasRemainingOutgoingAmount &&
                    (expenseSuggestions.length > 0 ||
                      otherExpenseCandidates.length > 0) &&
                    (
                      <form
                        method="post"
                        class="mt-3 grid gap-2 rounded-xl border border-[#dce2dc] bg-[#fafbfa] p-3 sm:grid-cols-[1fr_auto]"
                      >
                        <input
                          type="hidden"
                          name="csrf_token"
                          value={state.csrfToken}
                        />
                        <input
                          type="hidden"
                          name="intent"
                          value="manual_expense_match"
                        />
                        <input
                          type="hidden"
                          name="bank_transaction_id"
                          value={transaction.id}
                        />
                        <label>
                          <span class="sr-only">Náklad pro ruční párování</span>
                          <select
                            name="expense_id"
                            required
                            class="w-full rounded-lg border border-[#cad2cb] bg-white px-3 py-2 text-sm"
                          >
                            <option value="">Vyberte náklad…</option>
                            {expenseSuggestions.length > 0 && (
                              <optgroup label="Navržené shody">
                                {expenseSuggestions.map((suggestion) => (
                                  <option value={suggestion.expense.id}>
                                    {suggestion.expense.supplierInvoiceNumber ??
                                      suggestion.expense.supplierName}
                                    {suggestion.variableSymbolMatches
                                      ? " · shodný VS dokladu"
                                      : ""}
                                    {suggestion.amountMatches
                                      ? " · shodná částka"
                                      : ""}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {otherExpenseCandidates.length > 0 && (
                              <optgroup label="Ostatní náklady ve stejné měně">
                                {otherExpenseCandidates.map((expense) => (
                                  <option value={expense.id}>
                                    {expense.supplierInvoiceNumber ??
                                      expense.supplierName} · zbývá{" "}
                                    {formatBankAmountForDisplay(
                                      expense.remainingAmount,
                                      false,
                                    )} {expense.currency}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </label>
                        <button
                          type="submit"
                          class="rounded-lg border border-[#bfc9c1] bg-white px-4 py-2 text-sm font-semibold hover:bg-[#f1f4f1]"
                        >
                          Přiřadit k nákladu
                        </button>
                      </form>
                    )}
                  {transaction.amount.startsWith("-") &&
                    hasRemainingOutgoingAmount &&
                    expenseSuggestions.length === 0 &&
                    otherExpenseCandidates.length === 0 && (
                    <p class="mt-3 text-xs text-[#7a857d]">
                      Pro zbývající částku není dostupný náklad ve stejné měně.
                    </p>
                  )}
                </article>
              );
            })}
            {data.transactions.length === 0 && (
              <div class="px-6 py-14 text-center">
                <p class="font-semibold">Žádné bankovní pohyby</p>
                <p class="mt-2 text-sm text-[#667169]">
                  Připojte Fio účet a spusťte první synchronizaci nebo upravte
                  filtry.
                </p>
              </div>
            )}
          </div>
          {data.transactions.length === 200 && (
            <p class="mt-3 text-xs text-[#7a857d]">
              Zobrazeno posledních 200 výsledků. Pro užší výpis použijte filtry.
            </p>
          )}
        </section>
      </div>
    </main>
  );
});
