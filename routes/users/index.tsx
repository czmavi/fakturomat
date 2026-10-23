import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";
import {
  UserManagementError,
  type UserManagementInput,
  UserManagementService,
} from "@/services/user_management_service.ts";

const empty: UserManagementInput = {
  email: "",
  displayName: "",
  password: "",
  organizationIds: [],
  active: true,
};

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/login");
    if (!user.isAdmin) return new Response("Přístup odepřen.", { status: 403 });
    const data = await new UserManagementService().list(user.id);
    const id = ctx.url.searchParams.get("edit");
    const selected = data.users.find((item) =>
      item.id === id && item.is_admin !== 1
    );
    if (id && !selected) {
      return new Response("Uživatel nebyl nalezen.", { status: 404 });
    }
    return page({
      ...data,
      targetId: selected?.id ?? null,
      values: selected
        ? {
          email: selected.email,
          displayName: selected.display_name,
          password: "",
          organizationIds: selected.organizationIds,
          active: selected.is_active,
        }
        : empty,
      error: null as string | null,
      saved: ctx.url.searchParams.has("saved"),
    });
  },
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/login");
    if (!user.isAdmin) return new Response("Přístup odepřen.", { status: 403 });
    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return new Response("Platnost formuláře vypršela. Zkuste to znovu.", {
        status: 403,
      });
    }
    const targetId = String(form.get("user_id") ?? "") || null;
    const values: UserManagementInput = {
      email: String(form.get("email") ?? ""),
      displayName: String(form.get("display_name") ?? ""),
      password: String(form.get("password") ?? ""),
      active: form.get("active") === "1",
      organizationIds: form.getAll("organization_id").map(String),
    };
    const service = new UserManagementService();
    try {
      await service.save(user.id, targetId, values);
      return ctx.redirect("/users?saved=1", 303);
    } catch (error) {
      if (!(error instanceof UserManagementError)) throw error;
      if (error.status === 403 || error.status === 404) {
        return new Response(error.message, { status: error.status });
      }
      return page({
        ...await service.list(user.id),
        targetId,
        values: { ...values, password: "" },
        error: error.message,
        saved: false,
      }, { status: error.status });
    }
  },
});

const inputClass =
  "mt-2 w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3";
export default define.page<typeof handler>(({ data, state }) => (
  <main class="min-h-screen bg-[#f3f5f2] px-5 py-8 text-[#263029]">
    <Head>
      <title>Uživatelé · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-6xl">
      <a href="/dashboard" class="text-sm font-medium text-[#277a4c]">
        ← Zpět na přehled
      </a>
      <h1 class="mt-5 text-3xl font-semibold">Správa uživatelů</h1>
      <p class="mt-3 text-[#667169]">
        Správce má přístup ke všem organizacím. Ostatní uživatelé mohou pracovat
        pouze s těmi, které jim přiřadíte.
      </p>
      {data.saved && (
        <p role="status" class="mt-5 rounded-xl bg-[#d7eee0] p-4">
          Uživatel byl uložen. Změny přístupů platí ihned; upravený uživatel se
          musí znovu přihlásit.
        </p>
      )}
      <div class="mt-7 grid gap-7 lg:grid-cols-2">
        <section class="rounded-2xl border border-[#dce2dc] bg-white p-6">
          <h2 class="text-xl font-semibold">Uživatelé</h2>
          <ul class="mt-4 divide-y divide-[#dce2dc]">
            {data.users.map((user) => (
              <li key={user.id} class="py-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p class="font-semibold">{user.display_name}</p>
                    <p class="break-all text-sm text-[#667169]">{user.email}</p>
                  </div>
                  {user.is_admin !== 1 && (
                    <a
                      href={`/users?edit=${user.id}`}
                      class="text-sm font-semibold text-[#277a4c]"
                    >
                      Upravit
                    </a>
                  )}
                </div>
                <p class="mt-2 text-sm">
                  {user.is_admin === 1
                    ? "Správce · všechny organizace"
                    : user.is_active
                    ? "Aktivní účet"
                    : "Deaktivovaný účet"}
                </p>
                {user.is_admin !== 1 && (
                  <p class="mt-1 text-sm text-[#667169]">
                    {user.organizationIds.length
                      ? data.organizations.filter((o) =>
                        user.organizationIds.includes(o.id)
                      ).map((o) => o.display_name).join(", ")
                      : "Bez přiřazených organizací"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section class="rounded-2xl border border-[#dce2dc] bg-white p-6">
          <h2 class="text-xl font-semibold">
            {data.targetId ? "Upravit uživatele" : "Nový uživatel"}
          </h2>
          {data.error && (
            <p
              role="alert"
              class="mt-4 rounded-xl bg-[#fff5f3] p-4 text-[#962f25]"
            >
              {data.error}
            </p>
          )}
          <form method="post" class="mt-5 space-y-5">
            <input type="hidden" name="csrf_token" value={state.csrfToken} />
            <input type="hidden" name="user_id" value={data.targetId ?? ""} />
            <label class="block">
              Jméno<input
                name="display_name"
                required
                maxlength={120}
                value={data.values.displayName}
                class={inputClass}
              />
            </label>
            <label class="block">
              Přihlašovací e-mail<input
                type="email"
                name="email"
                required
                maxlength={254}
                autocomplete="off"
                value={data.values.email}
                class={inputClass}
              />
            </label>
            <label class="block">
              {data.targetId ? "Nové heslo (volitelné)" : "Heslo"}
              <input
                type="password"
                name="password"
                required={!data.targetId}
                minlength={12}
                maxlength={512}
                autocomplete="new-password"
                class={inputClass}
              />
              <span class="mt-2 block text-sm text-[#667169]">
                Alespoň 12 znaků. {data.targetId
                  ? "Prázdné pole zachová současné heslo."
                  : "Přihlašovací údaje předejte uživateli bezpečnou cestou; e-mail se automaticky neodesílá."}
              </span>
            </label>
            <fieldset>
              <legend class="font-semibold">Přístup k organizacím</legend>
              <p class="mt-1 text-sm text-[#667169]">
                Ve vybraných organizacích může uživatel zobrazovat i upravovat
                doklady, kontakty, banku a nastavení.
              </p>
              <div class="mt-3 space-y-3">
                {data.organizations.map((o) => (
                  <label key={o.id} class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="organization_id"
                      value={o.id}
                      checked={data.values.organizationIds.includes(o.id)}
                      class="size-4"
                    />
                    {o.display_name}
                  </label>
                ))}
              </div>
              {!data.organizations.length && (
                <p class="mt-3 text-sm">
                  Nejprve{" "}
                  <a href="/organizations/new" class="text-[#277a4c] underline">
                    vytvořte organizaci
                  </a>, nebo ji přiřaďte později.
                </p>
              )}
            </fieldset>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                name="active"
                value="1"
                checked={data.values.active}
                class="size-4"
              />Aktivní účet — může se přihlásit
            </label>
            <div class="flex items-center gap-4">
              <button
                type="submit"
                class="rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white"
              >
                {data.targetId ? "Uložit změny" : "Vytvořit uživatele"}
              </button>
              {data.targetId && (
                <a href="/users" class="text-sm text-[#277a4c]">
                  Zrušit / nový uživatel
                </a>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  </main>
));
