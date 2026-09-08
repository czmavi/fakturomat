import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { PostgresOrganizationRepository } from "@/repositories/organization_repository.ts";

export const handler = define.handlers(async (ctx) => {
  const user = ctx.state.user;
  if (user === null) return ctx.redirect("/login");

  const organizations = await new PostgresOrganizationRepository().listForUser(
    user.id,
  );
  if (organizations[0]) {
    return ctx.redirect(`/o/${organizations[0].id}/dashboard`);
  }

  return page({ user });
});

export default define.page<typeof handler>(({ data, state }) => (
  <main class="min-h-screen bg-[#f3f5f2]">
    <Head>
      <title>Přehled · Fakturomat</title>
    </Head>
    <header class="border-b border-[#dce2dc] bg-white">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div class="flex items-center gap-3">
          <div class="grid size-9 place-items-center rounded-xl bg-[#183e2a] font-bold text-white">
            F
          </div>
          <span class="font-semibold text-[#183e2a]">Fakturomat</span>
        </div>
        <form method="post" action="/logout">
          <input type="hidden" name="csrf_token" value={state.csrfToken} />
          <button
            class="rounded-lg px-3 py-2 text-sm font-medium text-[#556159] hover:bg-[#edf1ed]"
            type="submit"
          >
            Odhlásit se
          </button>
        </form>
      </div>
    </header>
    <section class="mx-auto max-w-6xl px-5 py-12">
      <p class="text-sm font-medium text-[#277a4c]">
        Začněte prvním subjektem
      </p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight">
        Dobrý den, {data.user.displayName}
      </h1>
      <p class="mt-3 max-w-2xl leading-7 text-[#667169]">
        Zatím nemáte přístup k žádnému subjektu. Vytvořte OSVČ, spolek nebo
        společnost, pro kterou chcete spravovat doklady.
      </p>
      <a
        href="/organizations/new"
        class="mt-7 inline-flex rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b]"
      >
        Vytvořit první subjekt
      </a>
    </section>
  </main>
));
