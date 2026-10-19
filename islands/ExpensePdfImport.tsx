import { mergeExpenseExtraction } from "@/domain/expenses/enrichment.ts";
import type { ContactFormInput } from "@/domain/contacts/types.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import ExpenseForm, {
  type ExpenseFormProps,
  expenseInputFromForm,
} from "@/components/ExpenseForm.tsx";

export default function ExpensePdfImport(
  props: ExpenseFormProps & {
    expenseId?: string;
    attachments?: { id: string; filename: string }[];
    autoExtract?: boolean;
  },
) {
  const [attachmentId, setAttachmentId] = useState(
    props.attachments?.length === 1 ? props.attachments[0].id : "",
  );
  const [suggestedContact, setSuggestedContact] = useState<
    ContactFormInput | undefined
  >();
  const [contacts, setContacts] = useState(props.contacts);
  const pending = useRef(false);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (props.autoExtract && attachmentId && !autoStarted.current) {
      autoStarted.current = true;
      void extract();
    }
  }, []);
  const [values, setValues] = useState(props.values);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState(props.error);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [proof, setProof] = useState("");
  const [version, setVersion] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [verifiedByName, setVerifiedByName] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  function selectFile(file: File | null) {
    setProof("");
    setRecipient("");
    setWarnings([]);
    setError(null);
    if (
      file &&
      (file.size === 0 || file.size > 20 * 1024 * 1024 ||
        !/\.pdf$/i.test(file.name) ||
        (file.type && file.type !== "application/pdf"))
    ) {
      setError("Vyberte jeden PDF soubor o velikosti nejvýše 20 MB.");
      setSelectedFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setSelectedFile(file);
    if (!file && fileInput.current) fileInput.current.value = "";
  }

  async function extract() {
    const file = fileInput.current?.files?.[0];
    if (pending.current) return;
    if (!file && !(props.expenseId && attachmentId)) {
      setError("Vyberte PDF fakturu.");
      return;
    }
    if (file && file.size > 20 * 1024 * 1024) {
      setError("PDF může mít nejvýše 20 MB.");
      return;
    }
    const currentForm = document.getElementById("new-expense");
    const current = currentForm instanceof HTMLFormElement
      ? expenseInputFromForm(new FormData(currentForm))
      : values;
    pending.current = true;
    setBusy(true);
    setError(null);
    setProof("");
    setRecipient("");
    setWarnings([]);
    try {
      const form = new FormData();
      form.set("csrf_token", props.csrfToken);
      if (props.expenseId) {
        form.set("expense_id", props.expenseId);
        form.set("attachment_id", attachmentId);
      } else if (file) form.set("pdf", file);
      const response = await fetch(
        `/o/${props.organizationId}/expenses/extract`,
        { method: "POST", body: form },
      );
      if (response.redirected || response.status === 401) {
        throw new Error(
          "Přihlášení vypršelo. Přihlaste se znovu a načtěte fakturu.",
        );
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(
          "Server nemohl fakturu zpracovat. Zkuste to znovu nebo soubor odeberte a vyplňte náklad ručně.",
        );
      }
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "PDF se nepodařilo zpracovat.");
      }
      setValues(mergeExpenseExtraction(current, result.values));
      setWarnings(result.warnings ?? []);
      setSuggestedContact(
        result.values.contactId || current.contactId
          ? undefined
          : result.supplier,
      );
      if (Array.isArray(result.contacts)) {
        setContacts((previous) => [
          ...previous.filter((contact) =>
            !result.contacts.some((fresh: { id: string }) =>
              fresh.id === contact.id
            )
          ),
          ...result.contacts,
        ]);
      }
      setVersion((value) => value + 1);
      setProof(result.proof);
      setVerifiedByName(result.recipientVerification === "name");
      setRecipient(
        result.recipient.name || result.recipient.ico || result.recipient.dic,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "PDF se nepodařilo zpracovat.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section class="mt-6 rounded-xl border border-[#cad2cb] bg-[#f7f9f7] p-4">
        <h2 class="font-semibold">
          {props.expenseId ? "Doplnit s AI" : "Načíst náklad z PDF faktury"}
        </h2>
        <p class="mt-2 text-sm text-[#667169]">
          PDF odešleme do OpenAI a ověříme odběratele vůči vybrané firmě. Údaje
          před uložením zkontrolujte.
        </p>
        {props.expenseId
          ? (
            <label class="mt-4 block text-sm font-medium">
              Uložená PDF příloha
              <select
                value={attachmentId}
                disabled={busy}
                onChange={(event) => setAttachmentId(event.currentTarget.value)}
                class="mt-2 w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3"
              >
                <option value="">Vyberte PDF přílohu</option>
                {props.attachments?.map((file) => (
                  <option key={file.id} value={file.id}>{file.filename}</option>
                ))}
              </select>
              {!props.attachments?.length && (
                <span class="mt-2 block text-[#667169]">
                  Nejprve nahrajte PDF fakturu v detailu nákladu.
                </span>
              )}
            </label>
          )
          : (
            <div
              class={`mt-4 rounded-xl border-2 border-dashed p-5 transition-colors ${
                dragging
                  ? "border-[#277a4c] bg-[#e5f3e9]"
                  : "border-[#a9bcae] bg-white"
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!busy) {
                  dragDepth.current++;
                  setDragging(true);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = busy ? "none" : "copy";
                }
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                if (busy || !event.dataTransfer) return;
                const files = event.dataTransfer.files;
                if (files.length !== 1) {
                  setError("Přetáhněte prosím právě jeden PDF soubor.");
                  return;
                }
                // Keep the actual input populated so the PDF is submitted with the expense.
                if (fileInput.current) fileInput.current.files = files;
                selectFile(files[0]);
              }}
            >
              <p class="font-semibold text-[#183e2a]">
                Přetáhněte PDF fakturu sem
              </p>
              <p class="mt-1 text-sm text-[#667169]">
                nebo klikněte na tlačítko Vybrat soubor. Maximálně 20 MB.
              </p>
              <input
                ref={fileInput}
                type="file"
                name="pdf"
                form="new-expense"
                accept="application/pdf,.pdf"
                disabled={busy}
                class="mt-4 block w-full rounded-lg text-sm text-[#667169] file:mr-4 file:cursor-pointer file:rounded-xl file:border-0 file:bg-[#183e2a] file:px-4 file:py-3 file:font-semibold file:text-white hover:file:bg-[#23583b] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#277a4c] disabled:opacity-50"
                aria-label="Vybrat PDF fakturu"
                onChange={() =>
                  selectFile(fileInput.current?.files?.[0] ?? null)}
              />
              {selectedFile && (
                <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p role="status" class="break-all text-sm text-[#183e2a]">
                    {selectedFile.name} ·{" "}
                    {(selectedFile.size / 1024 / 1024).toLocaleString("cs-CZ", {
                      maximumFractionDigits: 2,
                    })} MB
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectFile(null)}
                    class="rounded-lg px-3 py-2 text-sm font-semibold text-[#962f25] hover:bg-[#fff5f3] disabled:opacity-50"
                  >
                    Odebrat soubor
                  </button>
                </div>
              )}
            </div>
          )}
        <button
          type="button"
          disabled={busy || (props.expenseId ? !attachmentId : !selectedFile)}
          onClick={extract}
          class="mt-4 rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? "Zpracovávám PDF…"
            : props.expenseId
            ? "Doplnit s AI"
            : "Načíst a ověřit fakturu"}
        </button>
        {warnings.length > 0 && (
          <div
            role="alert"
            class="mt-4 space-y-2 rounded-xl border border-[#e5c56e] bg-[#fff8e1] px-4 py-3 text-sm text-[#76510c]"
          >
            {warnings.map((message) => <p key={message}>{message}</p>)}
          </div>
        )}
        {recipient && (
          <p role="status" class="mt-3 text-sm text-[#277a4c]">
            {verifiedByName
              ? "Odběratel se shoduje podle názvu"
              : "Odběratel ověřen podle IČO/DIČ"}: {recipient}.
            {verifiedByName &&
              " Na faktuře chybí IČO a DIČ odběratele; zkontrolujte prosím jeho údaje."}
            {" "}
            {props.expenseId
              ? "Navržené údaje zkontrolujte a potvrďte tlačítkem Uložit změny."
              : "PDF se připojí při uložení nákladu."}
          </p>
        )}
      </section>
      <ExpenseForm
        key={version}
        {...props}
        contacts={contacts}
        suggestedContact={suggestedContact}
        busy={busy}
        values={values}
        error={error}
        formId="new-expense"
        multipart={!props.expenseId}
        pdfProof={proof}
        disabled={busy || (Boolean(selectedFile) && !proof)}
      />
    </>
  );
}
