import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type { BankAccount } from "@/domain/banking/types.ts";
import type { InvoiceTemplate } from "@/domain/invoices/template_types.ts";
import { formatBankAccount } from "@/domain/banking/types.ts";
import type {
  OrganizationSettings,
  OrganizationSettingsInput,
} from "@/domain/organizations/settings.ts";
import { PostgresBankAccountRepository } from "@/repositories/bank_account_repository.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";
import { PostgresOrganizationSettingsRepository } from "@/repositories/organization_settings_repository.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import {
  OrganizationSettingsService,
  OrganizationSettingsValidationError,
} from "@/services/organization_settings_service.ts";
import { getObjectStorage } from "@/services/storage/storage_factory.ts";

interface SettingsPageData {
  values: OrganizationSettingsInput;
  bankAccounts: BankAccount[];
  hasLogo: boolean;
  error: string | null;
  saved: boolean;
  templates: InvoiceTemplate[];
}

function inputFromSettings(
  settings: OrganizationSettings,
): OrganizationSettingsInput {
  return {
    type: settings.type,
    officialName: settings.officialName,
    displayName: settings.displayName,
    ico: settings.ico ?? "",
    dic: settings.dic ?? "",
    street: settings.street ?? "",
    city: settings.city ?? "",
    postalCode: settings.postalCode ?? "",
    country: settings.country,
    email: settings.email ?? "",
    phone: settings.phone ?? "",
    website: settings.website ?? "",
    defaultCurrency: settings.defaultCurrency,
    defaultDueDays: String(settings.defaultDueDays),
    defaultInvoiceTemplateId: settings.defaultInvoiceTemplateId,
    invoiceFooter: settings.invoiceFooter ?? "",
    customNote: settings.customNote ?? "",
  };
}

function inputFromForm(form: FormData): OrganizationSettingsInput {
  const value = (name: string) => String(form.get(name) ?? "");
  return {
    type: value("type"),
    officialName: value("official_name"),
    displayName: value("display_name"),
    ico: value("ico"),
    dic: value("dic"),
    street: value("street"),
    city: value("city"),
    postalCode: value("postal_code"),
    country: value("country"),
    email: value("email"),
    phone: value("phone"),
    website: value("website"),
    defaultCurrency: value("default_currency"),
    defaultDueDays: value("default_due_days"),
    defaultInvoiceTemplateId: value("default_invoice_template_id"),
    invoiceFooter: value("invoice_footer"),
    customNote: value("custom_note"),
  };
}

export const handler = define.handlers<SettingsPageData>({
  async GET(ctx) {
    const user = ctx.state.user!;
    const organizationId = ctx.params.organizationId;
    const settingsRepository = new PostgresOrganizationSettingsRepository();
    const [settings, bankAccounts, templates] = await Promise.all([
      settingsRepository.findForUser(organizationId, user.id),
      new PostgresBankAccountRepository().listForUser(organizationId, user.id),
      new PostgresInvoiceTemplateRepository().list(),
    ]);
    if (settings === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      values: inputFromSettings(settings),
      bankAccounts,
      hasLogo: settings.logoStorageKey !== null,
      error: null,
      saved: ctx.url.searchParams.get("saved") === "1",
      templates,
    });
  },
  async POST(ctx) {
    const user = ctx.state.user!;
    const organizationId = ctx.params.organizationId;
    const form = await ctx.req.formData();
    const values = inputFromForm(form);
    const repository = new PostgresOrganizationSettingsRepository();

    const renderError = async (error: string, status: number) => {
      const [settings, bankAccounts, templates] = await Promise.all([
        repository.findForUser(organizationId, user.id),
        new PostgresBankAccountRepository().listForUser(
          organizationId,
          user.id,
        ),
        new PostgresInvoiceTemplateRepository().list(),
      ]);
      return page({
        values,
        bankAccounts,
        hasLogo: settings?.logoStorageKey !== null &&
          settings?.logoStorageKey !== undefined,
        error,
        saved: false,
        templates,
      }, { status });
    };

    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return await renderError(
        "Platnost formuláře vypršela. Zkuste to znovu.",
        403,
      );
    }

    const logoValue = form.get("logo");
    const logo = logoValue instanceof File && logoValue.size > 0
      ? logoValue
      : null;
    try {
      const updated = await new OrganizationSettingsService(
        repository,
        getObjectStorage(),
        new PostgresInvoiceTemplateRepository(),
      ).update({
        organizationId,
        userId: user.id,
        values,
        logo,
        removeLogo: form.has("remove_logo"),
      });
      if (!updated) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(`/o/${organizationId}/settings?saved=1`, 303);
    } catch (error) {
      if (error instanceof OrganizationSettingsValidationError) {
        return await renderError(error.message, 422);
      }
      throw error;
    }
  },
});

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default define.page<typeof handler>(({ data, state, params }) => {
  const root = `/o/${params.organizationId}/settings`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Nastavení · {state.currentOrganization?.displayName}</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <p class="text-sm font-semibold text-[#277a4c]">Nastavení subjektu</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Fakturační profil
        </h1>

        {data.saved && (
          <div
            role="status"
            class="mt-6 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Nastavení bylo uloženo.
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

        <form
          method="post"
          enctype="multipart/form-data"
          class="mt-8 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8"
        >
          <input type="hidden" name="csrf_token" value={state.csrfToken} />
          <div class="grid gap-5 sm:grid-cols-2">
            <label class="block">
              <span class="mb-2 block text-sm font-medium">Typ subjektu</span>
              <select name="type" class={inputClass}>
                <option value="OSVC" selected={data.values.type === "OSVC"}>
                  OSVČ
                </option>
                <option
                  value="ASSOCIATION"
                  selected={data.values.type === "ASSOCIATION"}
                >
                  Spolek
                </option>
                <option value="SRO" selected={data.values.type === "SRO"}>
                  s.r.o.
                </option>
                <option value="OTHER" selected={data.values.type === "OTHER"}>
                  Jiný
                </option>
              </select>
            </label>
            <label class="block">
              <span class="mb-2 block text-sm font-medium">
                Zobrazovaný název
              </span>
              <input
                name="display_name"
                value={data.values.displayName}
                maxlength={120}
                required
                class={inputClass}
              />
            </label>
            <label class="block sm:col-span-2">
              <span class="mb-2 block text-sm font-medium">
                Oficiální název
              </span>
              <input
                name="official_name"
                value={data.values.officialName}
                maxlength={200}
                required
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-2 block text-sm font-medium">IČO</span>
              <input
                name="ico"
                value={data.values.ico}
                maxlength={8}
                inputmode="numeric"
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-2 block text-sm font-medium">DIČ</span>
              <input
                name="dic"
                value={data.values.dic}
                maxlength={20}
                class={inputClass}
              />
            </label>
            <label class="sm:col-span-2">
              <span class="mb-2 block text-sm font-medium">Ulice a číslo</span>
              <input
                name="street"
                value={data.values.street}
                maxlength={200}
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-2 block text-sm font-medium">Město</span>
              <input
                name="city"
                value={data.values.city}
                maxlength={120}
                class={inputClass}
              />
            </label>
            <div class="grid grid-cols-[1fr_90px] gap-3">
              <label>
                <span class="mb-2 block text-sm font-medium">PSČ</span>
                <input
                  name="postal_code"
                  value={data.values.postalCode}
                  maxlength={20}
                  class={inputClass}
                />
              </label>
              <label>
                <span class="mb-2 block text-sm font-medium">Země</span>
                <input
                  name="country"
                  value={data.values.country}
                  maxlength={2}
                  required
                  class={inputClass}
                />
              </label>
            </div>
            <label>
              <span class="mb-2 block text-sm font-medium">E-mail</span>
              <input
                type="email"
                name="email"
                value={data.values.email}
                maxlength={254}
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-2 block text-sm font-medium">Telefon</span>
              <input
                name="phone"
                value={data.values.phone}
                maxlength={60}
                class={inputClass}
              />
            </label>
            <label class="sm:col-span-2">
              <span class="mb-2 block text-sm font-medium">Web</span>
              <input
                type="url"
                name="website"
                value={data.values.website}
                maxlength={300}
                class={inputClass}
                placeholder="https://"
              />
            </label>
          </div>

          <div class="my-8 border-t border-[#e3e7e3]" />
          <div class="grid gap-6 sm:grid-cols-[120px_1fr] sm:items-center">
            <div class="grid size-28 place-items-center overflow-hidden rounded-2xl border border-[#dce2dc] bg-[#f5f7f5] text-3xl font-bold text-[#8b958e]">
              {data.hasLogo
                ? (
                  <img
                    src={root + "/logo"}
                    alt="Logo subjektu"
                    class="h-full w-full object-contain"
                  />
                )
                : "Logo"}
            </div>
            <div>
              <label class="block text-sm font-medium">Nové logo</label>
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp"
                class="mt-2 block w-full text-sm"
              />
              <p class="mt-2 text-xs text-[#758078]">
                PNG, JPEG nebo WebP, maximálně 2 MB.
              </p>
              {data.hasLogo && (
                <label class="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="remove_logo"
                    class="accent-[#277a4c]"
                  />{" "}
                  Odstranit současné logo
                </label>
              )}
            </div>
          </div>

          <div class="my-8 border-t border-[#e3e7e3]" />
          <div class="grid gap-5 sm:grid-cols-2">
            <label>
              <span class="mb-2 block text-sm font-medium">Výchozí měna</span>
              <input
                name="default_currency"
                value={data.values.defaultCurrency}
                maxlength={3}
                required
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-2 block text-sm font-medium">
                Výchozí splatnost ve dnech
              </span>
              <input
                type="number"
                name="default_due_days"
                value={data.values.defaultDueDays}
                min={0}
                max={365}
                required
                class={inputClass}
              />
            </label>
            <label class="sm:col-span-2">
              <span class="mb-2 block text-sm font-medium">
                Výchozí šablona faktury
              </span>
              <select
                name="default_invoice_template_id"
                class={inputClass}
                required
              >
                {data.templates.filter((template) => template.isActive).map((
                  template,
                ) => (
                  <option
                    value={template.id}
                    selected={data.values.defaultInvoiceTemplateId ===
                      template.id}
                  >
                    {template.name} · v{template.currentVersion}
                  </option>
                ))}
              </select>
              <span class="mt-2 block text-xs text-[#758078]">
                Použije se jako výchozí při vystavení nové faktury.
              </span>
            </label>
            <label class="sm:col-span-2">
              <span class="mb-2 block text-sm font-medium">
                Patička faktury
              </span>
              <textarea
                name="invoice_footer"
                maxlength={2000}
                rows={3}
                class={inputClass}
              >
                {data.values.invoiceFooter}
              </textarea>
            </label>
            <label class="sm:col-span-2">
              <span class="mb-2 block text-sm font-medium">
                Vlastní poznámka
              </span>
              <textarea
                name="custom_note"
                maxlength={5000}
                rows={3}
                class={inputClass}
              >
                {data.values.customNote}
              </textarea>
            </label>
          </div>
          <button
            type="submit"
            class="mt-7 rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b]"
          >
            Uložit nastavení
          </button>
        </form>

        <section class="mt-10">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-2xl font-semibold tracking-tight">
                Bankovní účty
              </h2>
              <p class="mt-1 text-sm text-[#667169]">
                Účty lze používat na fakturách i bez bankovní integrace.
              </p>
            </div>
            <a
              href={root + "/bank-accounts/new"}
              class="shrink-0 rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
            >
              Přidat účet
            </a>
          </div>
          <div class="mt-5 grid gap-4 sm:grid-cols-2">
            {data.bankAccounts.map((account) => (
              <article
                class={`rounded-2xl border bg-white p-5 ${
                  account.isActive
                    ? "border-[#dce2dc]"
                    : "border-[#e4e4e4] opacity-60"
                }`}
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h3 class="font-semibold">{account.name}</h3>
                    <p class="mt-1 font-mono text-sm text-[#667169]">
                      {formatBankAccount(account)}
                    </p>
                  </div>
                  {account.isDefault && (
                    <span class="rounded-full bg-[#dff2e5] px-2.5 py-1 text-xs font-semibold text-[#21643e]">
                      Výchozí
                    </span>
                  )}
                </div>
                <p class="mt-4 text-sm text-[#758078]">
                  {account.currency}
                  {account.bankName ? ` · ${account.bankName}` : ""}
                  {!account.isActive ? " · Neaktivní" : ""}
                </p>
                <a
                  href={`${root}/bank-accounts/${account.id}/edit`}
                  class="mt-4 inline-block text-sm font-semibold text-[#277a4c] hover:underline"
                >
                  Upravit účet
                </a>
              </article>
            ))}
            {data.bankAccounts.length === 0 && (
              <div class="rounded-2xl border border-dashed border-[#cbd3cc] p-6 text-sm text-[#667169] sm:col-span-2">
                Zatím není přidaný žádný bankovní účet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
});
