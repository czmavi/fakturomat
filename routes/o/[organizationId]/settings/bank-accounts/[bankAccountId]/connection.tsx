import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import BankConnectionForm from "@/components/BankConnectionForm.tsx";
import type { BankAccount, BankConnection } from "@/domain/banking/types.ts";
import { bankConnectionStatusLabel } from "@/domain/banking/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresBankConnectionRepository } from "@/repositories/bank_connection_repository.ts";
import {
  BankConnectionValidationError,
  createBankConnectionService,
} from "@/services/banking/bank_connection_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface PageData {
  account: BankAccount;
  connection: BankConnection | null;
  error: string | null;
  saved: boolean;
}

async function loadPageData(
  organizationId: string,
  bankAccountId: string,
  userId: string,
  error: string | null,
  saved = false,
): Promise<PageData | null> {
  const [account, connection] = await Promise.all([
    new PostgresBankAccountRepository().findForUser(
      organizationId,
      bankAccountId,
      userId,
    ),
    new PostgresBankConnectionRepository().findForUser(
      organizationId,
      bankAccountId,
      userId,
    ),
  ]);
  return account ? { account, connection, error, saved } : null;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.bankAccountId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const data = await loadPageData(
      ctx.params.organizationId,
      ctx.params.bankAccountId,
      ctx.state.user!.id,
      null,
      ctx.url.searchParams.get("saved") === "1",
    );
    return data ? page(data) : new Response("Stránka nebyla nalezena.", {
      status: 404,
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.bankAccountId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    const userId = ctx.state.user!.id;
    const renderError = async (message: string, status: number) => {
      const data = await loadPageData(
        ctx.params.organizationId,
        ctx.params.bankAccountId,
        userId,
        message,
      );
      return data ? page(data, { status }) : new Response(
        "Stránka nebyla nalezena.",
        { status: 404 },
      );
    };
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return await renderError(
        "Platnost formuláře vypršela. Zkuste to znovu.",
        403,
      );
    }
    const repository = new PostgresBankConnectionRepository();
    if (form.get("intent") === "disconnect") {
      if (
        !await repository.deleteForUser(
          ctx.params.organizationId,
          ctx.params.bankAccountId,
          userId,
        )
      ) {
        return new Response("Připojení nebylo nalezeno.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/settings/bank-accounts/${ctx.params.bankAccountId}/connection`,
        303,
      );
    }
    const service = createBankConnectionService(repository);
    try {
      const connection = await service.configureFio({
        organizationId: ctx.params.organizationId,
        bankAccountId: ctx.params.bankAccountId,
        userId,
        token: String(form.get("token") ?? ""),
        enabled: form.has("enabled"),
      });
      if (connection === null) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/settings/bank-accounts/${ctx.params.bankAccountId}/connection?saved=1`,
        303,
      );
    } catch (error) {
      if (error instanceof BankConnectionValidationError) {
        return await renderError(error.message, 422);
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => {
  const accountRoot =
    `/o/${params.organizationId}/settings/bank-accounts/${params.bankAccountId}`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Fio API · {data.account.name} · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-2xl">
        <a
          href={accountRoot + "/edit"}
          class="text-sm font-semibold text-[#277a4c] hover:underline"
        >
          ← Zpět na bankovní účet
        </a>
        {data.saved && (
          <div
            role="status"
            class="mt-5 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Fio připojení bylo bezpečně uloženo.
          </div>
        )}
        <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
          <p class="text-sm font-semibold text-[#277a4c]">
            Read-only integrace
          </p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight">Fio API</h1>
          <p class="mt-2 text-sm leading-6 text-[#667169]">
            Účet:{" "}
            {data.account.name}. Aplikace používá pouze stahování pohybů a nikdy
            nevytváří platební příkazy.
          </p>
          {data.connection && (
            <div class="mt-5 rounded-xl bg-[#f1f5f2] px-4 py-3 text-sm">
              Stav:{" "}
              <strong>
                {bankConnectionStatusLabel(data.connection.status)}
              </strong>
            </div>
          )}
          <BankConnectionForm
            csrfToken={state.csrfToken}
            connected={data.connection !== null}
            status={data.connection?.status ?? null}
            error={data.error}
          />
        </section>
        {data.connection && (
          <form method="post" class="mt-5">
            <input type="hidden" name="csrf_token" value={state.csrfToken} />
            <input type="hidden" name="intent" value="disconnect" />
            <button
              type="submit"
              class="text-sm font-semibold text-[#962f25] hover:underline"
            >
              Odstranit Fio připojení
            </button>
          </form>
        )}
      </div>
    </main>
  );
});
