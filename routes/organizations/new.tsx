import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { PostgresOrganizationRepository } from "@/repositories/organization_repository.ts";
import {
  OrganizationService,
  OrganizationValidationError,
} from "@/services/organization_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface OrganizationFormData {
  error: string | null;
  values: {
    type: string;
    officialName: string;
    displayName: string;
  };
}

const EMPTY_VALUES = { type: "OSVC", officialName: "", displayName: "" };

export const handler = define.handlers<OrganizationFormData>({
  GET(ctx) {
    if (ctx.state.user === null) return ctx.redirect("/login");
    return page({ error: null, values: EMPTY_VALUES });
  },
  async POST(ctx) {
    const user = ctx.state.user;
    if (user === null) return ctx.redirect("/login");

    const form = await ctx.req.formData();
    const values = {
      type: String(form.get("type") ?? ""),
      officialName: String(form.get("official_name") ?? ""),
      displayName: String(form.get("display_name") ?? ""),
    };

    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
        values,
      }, { status: 403 });
    }

    try {
      const service = new OrganizationService(
        new PostgresOrganizationRepository(),
      );
      const organization = await service.create({
        ...values,
        ownerUserId: user.id,
      });
      return ctx.redirect(`/o/${organization.id}/dashboard`, 303);
    } catch (error) {
      if (error instanceof OrganizationValidationError) {
        return page({ error: error.message, values }, { status: 422 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state }) => (
  <main class="min-h-screen bg-[#f3f5f2] px-5 py-10 sm:py-16">
    <Head>
      <title>Nový subjekt · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-xl">
      <a
        href="/dashboard"
        class="text-sm font-medium text-[#277a4c] hover:underline"
      >
        ← Zpět na přehled
      </a>
      <section class="mt-5 rounded-3xl border border-[#dce2dc] bg-white p-7 shadow-[0_24px_70px_rgba(28,50,37,0.06)] sm:p-10">
        <p class="text-sm font-semibold text-[#277a4c]">Nový subjekt</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Základní údaje
        </h1>
        <p class="mt-3 text-sm leading-6 text-[#667169]">
          Podrobné fakturační údaje a bankovní účty doplníte v další etapě.
        </p>

        {data.error && (
          <div
            role="alert"
            class="mt-6 rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
          >
            {data.error}
          </div>
        )}

        <form method="post" class="mt-7 space-y-5">
          <input type="hidden" name="csrf_token" value={state.csrfToken} />
          <label class="block">
            <span class="mb-2 block text-sm font-medium">Typ subjektu</span>
            <select
              name="type"
              class="w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            >
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
            <span class="mb-2 block text-sm font-medium">Oficiální název</span>
            <input
              name="official_name"
              value={data.values.officialName}
              maxlength={200}
              required
              class="w-full rounded-xl border border-[#cad2cb] px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            />
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
              class="w-full rounded-xl border border-[#cad2cb] px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            />
            <span class="mt-2 block text-xs text-[#758078]">
              Krátký název použitý v přepínači subjektů.
            </span>
          </label>
          <button
            type="submit"
            class="w-full rounded-xl bg-[#183e2a] px-4 py-3 font-semibold text-white hover:bg-[#23583b] focus:outline-none focus:ring-3 focus:ring-[#b9ddc8]"
          >
            Vytvořit subjekt
          </button>
        </form>
      </section>
    </div>
  </main>
));
