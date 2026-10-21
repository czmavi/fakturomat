import { useRef, useState } from "preact/hooks";
import type { AresCompany } from "@/domain/ares/types.ts";

export default function AresLookup(
  { organization = false }: { organization?: boolean },
) {
  const button = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function lookup() {
    const form = button.current?.form;
    const icoField = form?.elements.namedItem("ico");
    if (!form || !(icoField instanceof HTMLInputElement) || pending.current) {
      return;
    }
    const ico = icoField.value.trim();
    setFailed(false);
    setMessage("");
    if (!/^\d{8}$/.test(ico)) {
      setFailed(true);
      setMessage("Zadejte IČO obsahující 8 číslic.");
      icoField.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/ares?ico=${encodeURIComponent(ico)}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Načtení z ARES se nezdařilo.");
      }
      if (!form.isConnected || icoField.value.trim() !== ico) return;
      const company = result as AresCompany;
      const fields: Record<string, string> = {
        [organization ? "official_name" : "name"]: company.name,
        ico: company.ico,
        dic: company.dic,
        street: company.street,
        city: company.city,
        postal_code: company.postalCode,
        country: company.country,
      };
      if (organization) {
        const display = form.elements.namedItem("display_name");
        if (display instanceof HTMLInputElement && !display.value.trim()) {
          fields.display_name = company.name.slice(0, 120);
        }
      } else if (company.contactType) {
        const type = form.elements.namedItem("type");
        if (type instanceof HTMLSelectElement) {
          type.value = company.contactType;
          type.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      for (const [name, value] of Object.entries(fields)) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement) {
          field.value = value;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      setMessage(
        !organization && !company.contactType
          ? "Údaje byly načteny z ARES. Typ kontaktu se nepodařilo určit; zkontrolujte, zda jde o osobu nebo firmu."
          : "Údaje byly načteny z ARES. Před uložením je zkontrolujte.",
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Načtení z ARES se nezdařilo. Zkuste to znovu.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div class="sm:col-span-2">
      <button
        ref={button}
        type="button"
        disabled={busy}
        onClick={lookup}
        class="rounded-xl border border-[#cad2cb] px-4 py-2.5 text-sm font-semibold text-[#277a4c] hover:bg-[#f5f7f5] disabled:opacity-50"
      >
        {busy ? "Načítám z ARES…" : "Načíst údaje z ARES podle IČO"}
      </button>
      <p
        role={failed ? "alert" : "status"}
        class={`mt-2 text-sm ${failed ? "text-[#962f25]" : "text-[#277a4c]"}`}
      >
        {message}
      </p>
    </div>
  );
}
