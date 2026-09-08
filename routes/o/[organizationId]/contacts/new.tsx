import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import ContactForm, {
  contactInputFromForm,
  EMPTY_CONTACT,
} from "@/components/ContactForm.tsx";
import type { ContactFormInput } from "@/domain/contacts/types.ts";
import { PostgresContactRepository } from "@/repositories/contact_repository.ts";
import {
  ContactService,
  ContactValidationError,
} from "@/services/contact_service.ts";
import { isValidCsrfToken } from "@/services/csrf_service.ts";

interface PageData {
  values: ContactFormInput;
  error: string | null;
}

export const handler = define.handlers<PageData>({
  GET() {
    return page({ values: EMPTY_CONTACT, error: null });
  },
  async POST(ctx) {
    const form = await ctx.req.formData();
    const values = contactInputFromForm(form);
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return page({
        values,
        error: "Platnost formuláře vypršela. Zkuste to znovu.",
      }, { status: 403 });
    }
    try {
      const contact = await new ContactService(new PostgresContactRepository())
        .create({
          ...values,
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
        });
      if (contact === null) {
        return new Response("Stránka nebyla nalezena.", { status: 404 });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/contacts/${contact.id}`,
        303,
      );
    } catch (error) {
      if (error instanceof ContactValidationError) {
        return page({ values, error: error.message }, { status: 422 });
      }
      throw error;
    }
  },
});

export default define.page<typeof handler>(({ data, state, params }) => (
  <main class="px-5 py-10 lg:px-8 lg:py-12">
    <Head>
      <title>Nový kontakt · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-2xl">
      <a
        href={`/o/${params.organizationId}/contacts`}
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na kontakty
      </a>
      <section class="mt-5 rounded-2xl border border-[#dce2dc] bg-white p-6 sm:p-8">
        <p class="text-sm font-semibold text-[#277a4c]">Adresář</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Nový kontakt</h1>
        <ContactForm
          values={data.values}
          error={data.error}
          csrfToken={state.csrfToken}
          submitLabel="Vytvořit kontakt"
        />
      </section>
    </div>
  </main>
));
