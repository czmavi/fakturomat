import { useState } from "preact/hooks";
import type { InvoiceTemplate } from "@/domain/invoices/template_types.ts";

interface Props {
  templates: Pick<
    InvoiceTemplate,
    "id" | "name" | "currentVersionId" | "currentVersion"
  >[];
  initialValue: string;
  organizationId: string;
}

export default function InvoiceTemplateSelect(props: Props) {
  const [selectedId, setSelectedId] = useState(props.initialValue);
  const selected =
    props.templates.find((template) => template.id === selectedId) ??
      props.templates[0];

  return (
    <div class="sm:col-span-2">
      <label class="block">
        <span class="mb-2 block text-sm font-medium">
          Výchozí šablona faktury
        </span>
        <select
          name="default_invoice_template_id"
          value={selected?.id ?? ""}
          onChange={(event) => setSelectedId(event.currentTarget.value)}
          class="w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]"
          required
        >
          {props.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} · v{template.currentVersion}
            </option>
          ))}
        </select>
      </label>
      <p class="mt-2 text-xs text-[#758078]">
        Použije se jako výchozí při vytvoření nového konceptu.
      </p>
      {selected && (
        <div class="mt-3">
          <a
            href={`/templates/${selected.id}/versions/${selected.currentVersionId}/preview?organizationId=${
              encodeURIComponent(props.organizationId)
            }`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex rounded-xl border border-[#cad2cb] px-4 py-2.5 text-sm font-semibold text-[#277a4c] hover:bg-[#eff9f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#277a4c]"
          >
            Otevřít náhled faktury
          </a>
          <p class="mt-2 text-xs text-[#758078]">
            PDF s ukázkovými údaji se otevře v nové kartě. Nastavení nemusíte
            nejdřív ukládat.
          </p>
        </div>
      )}
    </div>
  );
}
