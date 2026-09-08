import { page } from "fresh";
import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import type {
  InvoiceTemplate,
  InvoiceTemplateVersion,
} from "@/domain/invoices/template_types.ts";
import { isUuid } from "@/domain/organizations/types.ts";
import { PostgresInvoiceTemplateRepository } from "@/repositories/invoice_template_repository.ts";

interface PageData {
  template: InvoiceTemplate;
  versions: InvoiceTemplateVersion[];
}

export const handler = define.handlers<PageData>({
  async GET(ctx) {
    if (!isUuid(ctx.params.templateId)) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    const repository = new PostgresInvoiceTemplateRepository();
    const [template, versions] = await Promise.all([
      repository.find(ctx.params.templateId),
      repository.listVersions(ctx.params.templateId),
    ]);
    if (template === null) {
      return new Response("Stránka nebyla nalezena.", { status: 404 });
    }
    return page({ template, versions });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <main class="px-5 py-10 lg:py-12">
    <Head>
      <title>{data.template.name} · Šablony · Fakturomat</title>
    </Head>
    <div class="mx-auto max-w-7xl">
      <a
        href="/templates"
        class="text-sm font-semibold text-[#277a4c] hover:underline"
      >
        ← Zpět na šablony
      </a>
      <div class="mt-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded-full bg-[#edf3ee] px-2.5 py-1 text-xs font-semibold text-[#277a4c]">
              Aktuální v{data.template.currentVersion}
            </span>
          </div>
          <h1 class="mt-3 text-3xl font-semibold tracking-tight">
            {data.template.name}
          </h1>
          <p class="mt-2 text-sm text-[#667169]">
            {data.template.description ?? "Bez popisu"}
          </p>
        </div>
        <a
          href={`/templates/${data.template.id}/edit`}
          class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#23583b]"
        >
          Vytvořit novou verzi
        </a>
      </div>

      <section class="mt-8 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
        <div class="flex items-center justify-between border-b border-[#e3e7e3] px-5 py-4">
          <h2 class="font-semibold">Preview s testovacími daty</h2>
          <a
            href={`/templates/${data.template.id}/versions/${data.template.currentVersionId}/preview`}
            target="_blank"
            rel="noopener"
            class="text-sm font-semibold text-[#277a4c] hover:underline"
          >
            Otevřít samostatně
          </a>
        </div>
        <iframe
          src={`/templates/${data.template.id}/versions/${data.template.currentVersionId}/preview`}
          sandbox=""
          title={`Preview šablony ${data.template.name}`}
          class="h-[760px] w-full bg-white"
        />
      </section>

      <section class="mt-8">
        <h2 class="text-xl font-semibold">Historie verzí</h2>
        <div class="mt-4 overflow-hidden rounded-2xl border border-[#dce2dc] bg-white">
          {data.versions.map((version) => (
            <div class="flex items-center justify-between gap-4 border-b border-[#e6eae6] px-5 py-4 last:border-0">
              <div>
                <p class="font-semibold">
                  Verze {version.version}
                  {version.id === data.template.currentVersionId
                    ? " · aktuální"
                    : ""}
                </p>
                <p class="mt-1 text-xs text-[#7a857d]">
                  {new Intl.DateTimeFormat("cs-CZ", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(version.createdAt)}
                </p>
              </div>
              <a
                href={`/templates/${data.template.id}/versions/${version.id}/preview`}
                target="_blank"
                rel="noopener"
                class="text-sm font-semibold text-[#277a4c] hover:underline"
              >
                Preview
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  </main>
));
