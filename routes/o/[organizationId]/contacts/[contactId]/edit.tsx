import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ContactForm, {
  contactInputFromContact,
  contactInputFromForm,
} from "@/components/ContactForm.tsx";
import type { ContactFormInput } from "@/domain/contacts/types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import {
  ContactService,
  ContactValidationError,
} from "@/services/contact_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface PageData {
  values: ContactFormInput;
  error: string | null;
  archived: boolean;
}

export const handler = define.handlers<PageData>({
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
      values: contactInputFromContact(contact),
      error: null,
      archived: contact.archivedAt !== null,
    });
  },
  async POST(ctx) {
    if (!isUuid(ctx.params.contactId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const form = await ctx.req.formData();
    const values = contactInputFromForm(form);
    const repository = new PostgresContactRepository();
    const current = await repository.findForUser(
      ctx.params.organizationId,
      ctx.params.contactId,
      ctx.state.user!.id,
    );
    if (current === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }

    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
        archived: current.archivedAt !== null,
      }, { status: 403 });
    }
    try {
      const contact = await new ContactService(repository).update({
        ...values,
        id: ctx.params.contactId,
        organizationId: ctx.params.organizationId,
        userId: ctx.state.user!.id,
      });
      if (contact === null) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/contacts/${contact.id}?saved=1`,
        303,
      );
    } catch (error) {
      if (error instanceof ContactValidationError) {
        return page({
          values,
          error: error.message,
          archived: current.archivedAt !== null,
        }, { status: 422 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Upravit kontakt · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-2xl">
      <a
        href={`/o/${params.organizationId}/contacts/${params.contactId}`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na detail
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Adresář</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">
          Upravit kontakt
        </h1>
        {data.archived && (
          <p class="mt-3 rounded-xl bg-[#f1f2f1] px-4 py-3 text-sm text-[#667169]">
            Upravujete archivovaný kontakt.
          </p>
        )}
        <ContactForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Uložit kontakt"
        />
      </section>
    </div>
  </main>
));
