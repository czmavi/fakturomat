import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type { Contact } from "@/domain/contacts/types.ts";
import { contactTypeLabel } from "@/domain/contacts/types.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";

interface ContactListData {
  contacts: Contact[];
  search: string;
  includeArchived: boolean;
}

export const handler = define.handlers<ContactListData>({
  async GET(ctx) {
    const search = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 200);
    const includeArchived = ctx.url.searchParams.get("archived") === "1";
    const contacts = await new PostgresContactRepository().listForUser({
      organizationId: ctx.params.organizationId,
      userId: ctx.state.user!.id,
      search,
      includeArchived,
    });
    return page({ contacts, search, includeArchived });
  },
});

export default define.page<typeof handler>(({ data, params }) => {
  const root = `/o/${params.organizationId}/contacts`;
  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>Kontakty · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p class="text-sm font-semibold text-[#277a4c]">Adresář</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight">Kontakty</h1>
          </div>
          <a
            href={root + "/new"}
            class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
          >
            Přidat kontakt
          </a>
        </div>

        <form
          method="get"
          class="mt-8 grid gap-3 rounded-2xl border border-[#dce2dc] bg-white p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
        >
          <label>
            <span class="sr-only">Hledat kontakty</span>
            <input
              type="search"
              name="q"
              value={data.search}
              maxlength={200}
              placeholder="Název, IČO, DIČ nebo e-mail…"
              class="w-full rounded-xl border border-[#cad2cb] px-4 py-2.5 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
            />
          </label>
          <label class="flex items-center gap-2 px-1 text-sm text-[#59645c]">
            <input
              type="checkbox"
              name="archived"
              value="1"
              checked={data.includeArchived}
              class="size-4 accent-[#277a4c]"
            />{" "}
            Zobrazit archivované
          </label>
          <button
            type="submit"
            class="rounded-xl border border-[#bfc9c1] px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f4f1]"
          >
            Hledat
          </button>
        </form>

        <div class="mt-5 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
          {data.contacts.map((contact) => (
            <a
              href={`${root}/${contact.id}`}
              class={`grid gap-2 border-b border-[#e6eae6] px-5 py-4 last:border-b-0 hover:bg-[#f7f9f7] sm:grid-cols-[1fr_180px_220px] sm:items-center ${
                contact.archivedAt ? "opacity-55" : ""
              }`}
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate font-semibold">{contact.name}</span>
                  {contact.archivedAt && (
                    <span class="rounded-full bg-[#eceeec] px-2 py-0.5 text-xs text-[#68736b]">
                      Archivováno
                    </span>
                  )}
                </div>
                <p class="mt-1 text-xs text-[#7a857d]">
                  {contactTypeLabel(contact.type)}
                  {contact.ico ? ` · IČO ${contact.ico}` : ""}
                </p>
              </div>
              <span class="text-sm text-[#667169]">
                {[contact.city, contact.country].filter(Boolean).join(", ") ||
                  "—"}
              </span>
              <span class="truncate text-sm text-[#667169]">
                {contact.email ?? contact.phone ?? "—"}
              </span>
            </a>
          ))}
          {data.contacts.length === 0 && (
            <div class="px-6 py-14 text-center">
              <p class="font-semibold">Žádné kontakty</p>
              <p class="mt-2 text-sm text-[#667169]">
                {data.search
                  ? "Zkuste upravit hledaný výraz."
                  : "Přidejte prvního odběratele nebo dodavatele."}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
});
