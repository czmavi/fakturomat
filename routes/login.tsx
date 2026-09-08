import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import {
  AuthService,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
} from "@/services/auth_service.ts";
import { PostgresAuthRepository } from "@/repositories/auth_repository.ts";
import { createCookie } from "@/services/cookie_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface LoginData {
  error: string | null;
  email: string;
}

export const handler = define.handlers<LoginData>({
  GET(ctx) {
    if (ctx.state.user !== null) return ctx.redirect("/dashboard");
    return page({ error: null, email: "" });
  },
  async POST(ctx) {
    if (ctx.state.user !== null) return ctx.redirect("/dashboard");

    const form = await ctx.req.formData();
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
        email: "",
      }, {
        status: 403,
      });
    }

    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const service = new AuthService(new PostgresAuthRepository());
    const identity = await service.authenticate(email, password);
    if (identity === null) {
      return page({ error: "Neplatný e-mail nebo heslo.", email }, {
        status: 401,
      });
    }

    const response = ctx.redirect("/dashboard", 303);
    response.headers.append(
      "Set-Cookie",
      createCookie(SESSION_COOKIE_NAME, identity.token, {
        httpOnly: true,
        maxAge: SESSION_DURATION_SECONDS,
        sameSite: "Lax",
      }),
    );
    return response;
  },
});

export default define.page<typeof handler>(({ data, state }) => (
  <main class="min-h-screen bg-[#f3f5f2] px-5 py-12 sm:py-20">
    <Head>
      <title>Přihlášení · Fakturomat</title>
    </Head>
    <section class="mx-auto max-w-md rounded-3xl border border-[#dce2dc] bg-white p-8 shadow-[0_24px_70px_rgba(28,50,37,0.08)] sm:p-10">
      <div class="mb-9 flex items-center gap-3">
        <div class="grid size-11 place-items-center rounded-2xl bg-[#183e2a] text-lg font-bold text-white">
          F
        </div>
        <div>
          <p class="font-semibold tracking-tight text-[#183e2a]">Fakturomat</p>
          <p class="text-sm text-[#738078]">Interní fakturace</p>
        </div>
      </div>
      <h1 class="text-3xl font-semibold tracking-tight text-[#18211c]">
        Vítejte zpět
      </h1>
      <p class="mt-2 text-sm leading-6 text-[#667169]">
        Přihlaste se ke svým subjektům a dokladům.
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
          <span class="mb-2 block text-sm font-medium text-[#303a33]">
            E-mail
          </span>
          <input
            class="w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none transition focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            type="email"
            name="email"
            value={data.email}
            autocomplete="email"
            maxlength={254}
            required
            autofocus
          />
        </label>
        <label class="block">
          <span class="mb-2 block text-sm font-medium text-[#303a33]">
            Heslo
          </span>
          <input
            class="w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none transition focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            type="password"
            name="password"
            autocomplete="current-password"
            required
          />
        </label>
        <button
          class="w-full rounded-xl bg-[#183e2a] px-4 py-3 font-semibold text-white transition hover:bg-[#23583b] focus:outline-none focus:ring-3 focus:ring-[#b9ddc8]"
          type="submit"
        >
          Přihlásit se
        </button>
      </form>
    </section>
  </main>
));
