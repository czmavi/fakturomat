import AresLookup from "@/islands/AresLookup.tsx";
import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
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
    ico: string;
    dic: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
}

const EMPTY_VALUES = {
  type: "OSVC",
  officialName: "",
  displayName: "",
  ico: "",
  dic: "",
  street: "",
  city: "",
  postalCode: "",
  country: "CZ",
};

export const handler = define.handlers<OrganizationFormData>({
  GET(ctx) {
    if (ctx.state.user === null) return ctx.redirect("/login");
    if (!ctx.state.user.isAdmin) {
      return new Response("Přístup odepřen.", { status: 403 });
    }
    return page({ error: null, values: EMPTY_VALUES });
  },
  async POST(ctx) {
    const user = ctx.state.user;
    if (user === null) return ctx.redirect("/login");
    if (!user.isAdmin) return new Response("Přístup odepřen.", { status: 403 });

    const form = await ctx.req.formData();
    const values = {
      type: String(form.get("type") ?? ""),
      officialName: String(form.get("official_name") ?? ""),
      displayName: String(form.get("display_name") ?? ""),
      ico: String(form.get("ico") ?? ""),
      dic: String(form.get("dic") ?? ""),
      street: String(form.get("street") ?? ""),
      city: String(form.get("city") ?? ""),
      postalCode: String(form.get("postal_code") ?? ""),
      country: String(form.get("country") ?? "CZ"),
    };

    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
        values,
      }, { status: 403 });
    }

    try {
      const service = new OrganizationService(
        new D1OrganizationRepository(),
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
          Údaje vyplňte ručně nebo je načtěte z ARES podle IČO.
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
            <span class="mb-2 block text-sm font-medium">IČO</span>
            <input
              name="ico"
              value={data.values.ico}
              maxlength={8}
              inputmode="numeric"
              class="w-full rounded-xl border border-[#cad2cb] px-4 py-3"
            />
          </label>
          <AresLookup organization />
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
          {([
            ["dic", "DIČ", "dic", 20],
            ["street", "Ulice a číslo", "street", 200],
            ["city", "Město", "city", 120],
            ["postal_code", "PSČ", "postalCode", 20],
            ["country", "Země (ISO kód)", "country", 2],
          ] as const).map(([name, label, key, max]) => (
            <label class="block" key={name}>
              <span class="mb-2 block text-sm font-medium">{label}</span>
              <input
                name={name}
                value={data.values[key]}
                maxlength={max}
                required={name === "country"}
                class="w-full rounded-xl border border-[#cad2cb] px-4 py-3 outline-none focus:border-[#277a4c]"
              />
            </label>
          ))}
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
