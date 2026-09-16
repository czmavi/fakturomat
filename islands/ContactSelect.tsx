import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import type { JSX } from "preact";
import ContactForm, {
  contactInputFromForm,
  EMPTY_CONTACT,
} from "@/components/ContactForm.tsx";

interface Props {
  contacts: { id: string; name: string; archived: boolean }[];
  initialValue: string;
  organizationId: string;
  csrfToken: string;
  required?: boolean;
  initialSupplierName?: string;
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function ContactSelect(props: Props) {
  const [contacts, setContacts] = useState(props.contacts);
  const [selectedId, setSelectedId] = useState(props.initialValue);
  const [supplierName, setSupplierName] = useState(
    props.initialSupplierName ?? "",
  );
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(EMPTY_CONTACT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  const submit: JSX.SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (pending.current) return;
    const form = new FormData(event.currentTarget);
    setValues(contactInputFromForm(form));
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/o/${props.organizationId}/contacts/new`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      });
      if (response.redirected) {
        setError(
          "Přihlášení vypršelo. Přihlaste se znovu v jiné kartě a zkuste kontakt uložit.",
        );
        return;
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        setError("Kontakt se nepodařilo uložit. Zkuste to znovu.");
        return;
      }
      const result = await response.json();
      if (!response.ok) {
        setError(
          typeof result.error === "string"
            ? result.error
            : "Kontakt se nepodařilo uložit.",
        );
        return;
      }
      const contact = result.contact;
      if (
        typeof contact?.id !== "string" || typeof contact?.name !== "string"
      ) {
        throw new Error("Invalid contact response");
      }
      setContacts((current) => [...current, { ...contact, archived: false }]);
      setSelectedId(contact.id);
      if (!supplierName.trim()) setSupplierName(contact.name);
      setNotice(`Kontakt „${contact.name}“ byl vytvořen a vybrán.`);
      dialog.current?.close();
      select.current?.focus();
    } catch {
      setError(
        "Uložení se nepodařilo potvrdit. Zkontrolujte připojení a před dalším pokusem ověřte v adresáři, zda kontakt vznikl.",
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <div class="sm:col-span-2">
      <div
        class={props.initialSupplierName !== undefined
          ? "grid gap-5 sm:grid-cols-2"
          : ""}
      >
        {props.initialSupplierName !== undefined && (
          <label>
            <span class="mb-2 block text-sm font-medium">Dodavatel</span>
            <input
              name="supplier_name"
              value={supplierName}
              onInput={(event) => setSupplierName(event.currentTarget.value)}
              maxlength={200}
              required
              class={inputClass}
            />
          </label>
        )}
        <div>
          <label class="block">
            <span class="mb-2 block text-sm font-medium">
              {props.required ? "Odběratel" : "Kontakt v adresáři"}
            </span>
            <select
              ref={select}
              name="contact_id"
              value={selectedId}
              required={props.required}
              class={inputClass}
              onChange={(event) => {
                const id = event.currentTarget.value;
                setSelectedId(id);
                setNotice("");
                if (!supplierName.trim()) {
                  setSupplierName(
                    contacts.find((item) => item.id === id)?.name ?? "",
                  );
                }
              }}
            >
              <option value="">
                {props.required ? "Vyberte kontakt" : "Bez vazby na kontakt"}
              </option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.archived ? " · archivovaný" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            class="mt-3 rounded-lg text-sm font-semibold text-[#277a4c] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
            onClick={() => {
              setValues({ ...EMPTY_CONTACT, name: supplierName });
              setError(null);
              setOpen(true);
            }}
          >
            + Vytvořit kontakt
          </button>
          <p role="status" class="mt-2 text-sm text-[#277a4c]">{notice}</p>
        </div>
      </div>
      {open && createPortal(
        <dialog
          ref={dialog}
          aria-labelledby="new-contact-title"
          onClose={() => setOpen(false)}
          onCancel={(event) => {
            if (pending.current) event.preventDefault();
          }}
          class="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-[#dce2dc] bg-white p-6 text-[#18251c] shadow-xl backdrop:bg-black/40 sm:p-8"
        >
          <div class="flex items-center justify-between gap-4">
            <h2 id="new-contact-title" class="text-2xl font-semibold">
              Nový kontakt
            </h2>
            <button
              type="button"
              disabled={saving}
              onClick={() => dialog.current?.close()}
              class="rounded-lg px-3 py-2 text-sm font-semibold text-[#667169] hover:bg-[#f5f7f5] disabled:opacity-50"
            >
              Zrušit
            </button>
          </div>
          <p class="mt-2 text-sm text-[#667169]">
            Po vytvoření se kontakt rovnou vybere v dokladu.
          </p>
          <ContactForm
            values={values}
            csrfToken={props.csrfToken}
            error={error}
            submitLabel={saving ? "Ukládání…" : "Vytvořit a vybrat kontakt"}
            submitting={saving}
            onSubmit={submit}
          />
        </dialog>,
        document.body,
      )}
    </div>
  );
}
