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
    const wantsJson = ctx.req.headers.get("accept")?.includes(
      "application/json",
    );
    const errorResponse = (error: string, status: number) =>
      wantsJson
        ? Response.json({ error }, { status })
        : page({ values, error }, { status });
    if (!isValidCsrfToken(ctx.state.csrfToken, form.get("csrf_token"))) {
      return errorResponse(
        "Platnost formuláře vypršela. Zkuste to znovu.",
        403,
      );
    }
    try {
      const contact = await new ContactService(new PostgresContactRepository())
        .create({
          ...values,
          organizationId: ctx.params.organizationId,
          userId: ctx.state.user!.id,
        });
      if (contact === null) {
        return errorResponse("Stránka nebyla nalezena.", 404);
      }
      if (wantsJson) {
        return Response.json({
          contact: { id: contact.id, name: contact.name },
        }, {
          status: 201,
          headers: { "Cache-Control": "no-store" },
        });
      }
      return ctx.redirect(
        `/o/${ctx.params.organizationId}/contacts/${contact.id}`,
        303,
      );
    } catch (error) {
      if (error instanceof ContactValidationError) {
        return errorResponse(error.message, 422);
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
