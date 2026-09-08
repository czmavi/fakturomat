import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import BankAccountForm, {
  bankAccountInputFromForm,
  EMPTY_BANK_ACCOUNT,
} from "@/components/BankAccountForm.tsx";
import type { BankAccountInput } from "@/domain/banking/types.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import {
  BankAccountService,
  BankAccountValidationError,
} from "@/services/bank_account_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface PageData {
  values: BankAccountInput;
  error: string | null;
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    const settings = await new PostgresOrganizationSettingsRepository()
      .findForUser(
        ctx.params.organizationId,
        ctx.state.user!.id,
      );
    if (settings === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      values: { ...EMPTY_BANK_ACCOUNT, currency: settings.defaultCurrency },
      error: null,
    });
  },
  async POST(ctx) {
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
      ).create({
        ...values,
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
      <title>Nový bankovní účet · Fakturomat</title>
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
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Přidat účet</h1>
        <BankAccountForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Přidat účet"
        />
      </section>
    </div>
  </main>
));
