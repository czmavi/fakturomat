import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type { Contact } from "@/domain/contacts/types.ts";
import { contactTypeLabel } from "@/domain/contacts/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";

interface ContactDetailData {
  contact: Contact;
  saved: boolean;
}

export const handler = define.handlers<ContactDetailData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.contactId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const contact = await new PostgresContactRepository().findForUser(
      ctx.params.organizationId,
      ctx.params.contactId,
      ctx.state.user!.id,
    );
    if (contact === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({
      contact,
      saved: ctx.url.searchParams.get("saved") === "1",
    });
  },
});

function DetailItem(props: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt class="text-xs font-medium uppercase tracking-[0.08em] text-[#7a857d]">
        {props.label}
      </dt>
      <dd class="mt-1.5 text-[#263029]">{props.value ?? "—"}</dd>
    </div>
  );
}

export default define.page<typeof handler>(({ data, state, params }) => {
  const contact = data.contact;
  const root = `/o/${params.organizationId}/contacts`;
  const address = [
    contact.street,
    contact.postalCode,
    contact.city,
    contact.country,
  ]
    .filter(Boolean).join(", ");

  return (
    <main class="px-5 py-10 lg:px-8 lg:py-12">
      <Head>
        <title>{contact.name} · Kontakty · Fakturomat</title>
      </Head>
      <div class="mx-auto max-w-4xl">
        <a
          href={root}
          class="text-sm font-semibold text-[#277a4c] hover:underline"
        >
          ← Zpět na kontakty
        </a>
        {data.saved && (
          <div
            role="status"
            class="mt-5 rounded-xl border border-[#b9ddc8] bg-[#eff9f2] px-4 py-3 text-sm text-[#21643e]"
          >
            Kontakt byl uložen.
          </div>
        )}
        <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-semibold text-[#277a4c]">
                  {contactTypeLabel(contact.type)}
                </span>
                {contact.archivedAt && (
                  <span class="rounded-full bg-[#eceeec] px-2.5 py-1 text-xs font-semibold text-[#68736b]">
                    Archivováno
                  </span>
                )}
              </div>
              <h1 class="mt-3 text-3xl font-semibold tracking-tight">
                {contact.name}
              </h1>
            </div>
            <a
              href={`${root}/${contact.id}/edit`}
              class="rounded-xl border border-[#bfc9c1] px-4 py-2.5 text-sm font-semibold hover:bg-[#f1f4f1]"
            >
              Upravit
            </a>
          </div>

          <dl class="mt-8 grid gap-x-8 gap-y-6 border-t border-[#e3e7e3] pt-7 sm:grid-cols-2">
            <DetailItem label="IČO" value={contact.ico} />
            <DetailItem label="DIČ" value={contact.dic} />
            <DetailItem label="Adresa" value={address || null} />
            <DetailItem label="E-mail" value={contact.email} />
            <DetailItem label="Telefon" value={contact.phone} />
            <DetailItem
              label="Výchozí splatnost"
              value={contact.defaultDueDays === null
                ? null
                : `${contact.defaultDueDays} dní`}
            />
          </dl>
          {contact.note && (
            <div class="mt-7 border-t border-[#e3e7e3] pt-7">
              <h2 class="text-sm font-semibold">Poznámka</h2>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#5f6a62]">
                {contact.note}
              </p>
            </div>
          )}

          {!contact.archivedAt && (
            <form
              method="post"
              action={`${root}/${contact.id}/archive`}
              class="mt-8 border-t border-[#e3e7e3] pt-6"
            >
              <input type="hidden" name="csrf_token" value={state.csrfToken} />
              <button
                type="submit"
                class="text-sm font-semibold text-[#9a392e] hover:underline"
              >
                Archivovat kontakt
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
});
