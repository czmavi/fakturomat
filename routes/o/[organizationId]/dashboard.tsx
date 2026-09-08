import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";

export default define.page(({ state }) => {
  const organization = state.currentOrganization;
  if (organization === null) return null;

  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>{organization.displayName} · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <p class="text-sm font-semibold text-[#277a4c]">Přehled subjektu</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-[#18211c]">
          {organization.displayName}
        </h1>
        <p class="mt-3 max-w-2xl leading-7 text-[#667169]">
          Subjekt je oddělený vlastním URL scopem. Faktury, kontakty a další
          data budou vždy ověřována společně s jeho ID a membership přihlášeného
          uživatele.
        </p>

        <div class="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Typ subjektu", organization.type],
            ["Role", organization.role === "OWNER" ? "Vlastník" : "Člen"],
            ["Faktury", "Další etapa"],
            ["Bankovní účty", "Další etapa"],
          ].map(([label, value]) => (
            <article class="rounded-2xl border border-[#dce2dc] bg-white p-5">
              <p class="text-sm text-[#758078]">{label}</p>
              <p class="mt-2 font-semibold text-[#263029]">{value}</p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
});
