import { define } from "@/utils.ts";

export default define.layout(({ Component, state }) => (
  <div class="min-h-screen bg-[#f3f5f2]">
    <header class="border-b border-[#dce2dc] bg-white">
      <div class="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <a href="/dashboard" class="flex items-center gap-3">
          <span class="grid size-9 place-items-center rounded-xl bg-[#183e2a] font-bold text-white">
            F
          </span>
          <span class="font-semibold text-[#183e2a]">Fakturomat</span>
        </a>
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
      </div>
    </header>
    <Component />
  </div>
));
