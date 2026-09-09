import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import BankAccountForm, {
  bankAccountInputFromForm,
} from "@/components/BankAccountForm.tsx";
import type { BankAccount, BankAccountInput } from "@/domain/banking/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import {
  BankAccountService,
  BankAccountValidationError,
} from "@/services/bank_account_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface PageData {
  values: BankAccountInput;
  error: string | null;
}

function inputFromAccount(account: BankAccount): BankAccountInput {
  return {
    name: account.name,
    bankName: account.bankName ?? "",
    accountPrefix: account.accountPrefix ?? "",
    accountNumber: account.accountNumber ?? "",
    bankCode: account.bankCode ?? "",
    iban: account.iban ?? "",
    bic: account.bic ?? "",
    currency: account.currency,
    isDefault: account.isDefault,
    isActive: account.isActive,
  };
}

async function findAccount(
  ctx: {
    params: Record<string, string>;
    state: { user: { id: string } | null };
  },
) {
  if (!isUuid(ctx.params.bankAccountId)) return null;
  return await new PostgresBankAccountRepository().findForUser(
    ctx.params.organizationId,
    ctx.params.bankAccountId,
    ctx.state.user!.id,
  );
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const account = await findAccount(ctx);
    if (account === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({ values: inputFromAccount(account), error: null });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.bankAccountId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    const values = bankAccountInputFromForm(form);
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
      }, { status: 403 });
    }
    try {
      const account = await new BankAccountService(
        new PostgresBankAccountRepository(),
      ).update({
        ...values,
        id: ctx.params.bankAccountId,
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
      });
      if (account === null) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/settings?saved=1`,
        303,
      );
    } catch (error) {
      if (error instanceof BankAccountValidationError) {
        return page({ values, error: error.message }, { status: 422 });
      }
      if (
        typeof error === "object" && error !== null && "code" in error &&
        error.code === "23505"
      ) {
        return page(
          { values, error: "Tento účet už je u subjektu evidovaný." },
          { status: 409 },
        );
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Upravit bankovní účet · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-2xl">
      <a
        href={`/o/${params.organizationId}/settings`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět do nastavení
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Bankovní účet</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Upravit účet</h1>
        <BankAccountForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Uložit účet"
        />
        <div class="mt-6 border-t border-[#e3e7e3] pt-5">
          <a
            href={`/o/${params.organizationId}/settings/bank-accounts/${params.bankAccountId}/connection`}
            class="text-sm font-semibold text-[#277a4c] hover:underline"
          >
            Nastavit read-only Fio API připojení →
          </a>
        </div>
      </section>
    </div>
  </main>
));
