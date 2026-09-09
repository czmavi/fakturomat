import { define } from "@/utils.ts";

export default define.layout(({ Component, state, url }) => {
  const organization = state.currentOrganization;
  if (organization === null) return null;

  const root = `/o/${organization.id}`;
  return (
    <div class="min-h-screen bg-[#f3f5f2] lg:grid lg:grid-cols-[260px_1fr]">
      <aside class="border-b border-[#dce2dc] bg-[#163b28] text-white lg:min-h-screen lg:border-b-0 lg:border-r lg:border-[#2a513a]">
        <div class="flex items-center justify-between gap-4 px-5 py-5 lg:block lg:px-6">
          <a href={root + "/dashboard"} class="flex items-center gap-3">
            <div class="grid size-9 place-items-center rounded-xl bg-white font-bold text-[#183e2a]">
              F
            </div>
            <span class="font-semibold tracking-tight">Fakturomat</span>
          </a>

          <details class="relative lg:mt-8">
            <summary class="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 hover:bg-white/12 lg:w-full">
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[#d8efdf] text-sm font-bold text-[#183e2a]">
                {organization.displayName.slice(0, 1).toLocaleUpperCase(
                  "cs-CZ",
                )}
              </span>
              <span class="hidden min-w-0 flex-1 text-left lg:block">
                <span class="block truncate text-sm font-semibold">
                  {organization.displayName}
                </span>
                <span class="block text-xs text-white/55">
                  Přepnout subjekt
                </span>
              </span>
              <span aria-hidden="true" class="text-white/55">⌄</span>
            </summary>
            <div class="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[#dce2dc] bg-white p-2 text-[#18211c] shadow-xl lg:right-auto lg:left-0">
              {state.organizations.map((item) => (
                <a
                  href={`/o/${item.id}/dashboard`}
                  class={`block rounded-lg px-3 py-2.5 text-sm hover:bg-[#edf3ee] ${
                    item.id === organization.id
                      ? "bg-[#edf3ee] font-semibold"
                      : ""
                  }`}
                  aria-current={item.id === organization.id
                    ? "page"
                    : undefined}
                >
                  {item.displayName}
                </a>
              ))}
              <div class="my-1 border-t border-[#e3e7e3]" />
              <a
                href="/organizations/new"
                class="block rounded-lg px-3 py-2.5 text-sm font-medium text-[#277a4c] hover:bg-[#edf3ee]"
              >
                + Přidat subjekt
              </a>
            </div>
          </details>
        </div>

        <nav aria-label="Hlavní navigace" class="hidden px-4 pb-6 lg:block">
          <a
            href={root + "/dashboard"}
            aria-current={url.pathname === root + "/dashboard"
              ? "page"
              : undefined}
            class={`block rounded-xl px-4 py-3 text-sm font-semibold ${
              url.pathname === root + "/dashboard"
                ? "bg-white/12"
                : "hover:bg-white/8"
            }`}
          >
            Přehled
          </a>
          <a
            href={root + "/invoices"}
            aria-current={url.pathname.startsWith(root + "/invoices")
              ? "page"
              : undefined}
            class={`mt-1 block rounded-xl px-4 py-3 text-sm font-semibold ${
              url.pathname.startsWith(root + "/invoices")
                ? "bg-white/12"
                : "hover:bg-white/8"
            }`}
          >
            Faktury
          </a>
          <a
            href={root + "/contacts"}
            aria-current={url.pathname.startsWith(root + "/contacts")
              ? "page"
              : undefined}
            class={`mt-1 block rounded-xl px-4 py-3 text-sm font-semibold ${
              url.pathname.startsWith(root + "/contacts")
                ? "bg-white/12"
                : "hover:bg-white/8"
            }`}
          >
            Kontakty
          </a>
          <a
            href={root + "/expenses"}
            aria-current={url.pathname.startsWith(root + "/expenses")
              ? "page"
              : undefined}
            class={`mt-1 block rounded-xl px-4 py-3 text-sm font-semibold ${
              url.pathname.startsWith(root + "/expenses")
                ? "bg-white/12"
                : "hover:bg-white/8"
            }`}
          >
            Náklady
          </a>
          <a
            href={root + "/banking"}
            aria-current={url.pathname.startsWith(root + "/banking")
              ? "page"
              : undefined}
            class={`mt-1 block rounded-xl px-4 py-3 text-sm font-semibold ${
              url.pathname.startsWith(root + "/banking")
                ? "bg-white/12"
                : "hover:bg-white/8"
            }`}
          >
            Banka
          </a>
          <a
            href={root + "/settings"}
            aria-current={url.pathname.startsWith(root + "/settings")
              ? "page"
              : undefined}
            class={`mt-1 block rounded-xl px-4 py-3 text-sm font-semibold ${
              url.pathname.startsWith(root + "/settings")
                ? "bg-white/12"
                : "hover:bg-white/8"
            }`}
          >
            Nastavení
          </a>
          <a
            href="/templates"
            class="mt-4 block rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold hover:bg-white/8"
          >
            Šablony faktur
          </a>
        </nav>
      </aside>

      <div class="min-w-0">
        <header class="flex items-center justify-between border-b border-[#dce2dc] bg-white px-5 py-4 lg:px-8">
          <div>
            <p class="text-xs font-medium uppercase tracking-[0.12em] text-[#7a867e]">
              Aktivní subjekt
            </p>
            <p class="font-semibold text-[#263029]">
              {organization.displayName}
            </p>
          </div>
          <div class="flex items-center gap-4">
            <span class="hidden text-sm text-[#68736b] sm:inline">
              {state.user?.displayName}
            </span>
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
        <Component />
      </div>
    </div>
  );
});
