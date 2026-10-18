import { useRef, useState } from "preact/hooks";
import ExpenseForm, {
  type ExpenseFormProps,
} from "@/components/ExpenseForm.tsx";

export default function ExpensePdfImport(props: ExpenseFormProps) {
  const [values, setValues] = useState(props.values);
  const [error, setError] = useState(props.error);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [proof, setProof] = useState("");
  const [version, setVersion] = useState(0);
  const [recipient, setRecipient] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  async function extract() {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Vyberte PDF fakturu.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("PDF může mít nejvýše 20 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    setProof("");
    setRecipient("");
    try {
      const form = new FormData();
      form.set("csrf_token", props.csrfToken);
      form.set("pdf", file);
      const response = await fetch(
        `/o/${props.organizationId}/expenses/extract`,
        { method: "POST", body: form },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "PDF se nepodařilo zpracovat.");
      }
      setValues({ ...result.values, categoryId: props.values.categoryId });
      setVersion((value) => value + 1);
      setProof(result.proof);
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
      setBusy(false);
    }
  }
  return (
    <>
      <section class="mt-6 rounded-xl border border-[#cad2cb] bg-[#f7f9f7] p-4">
        <h2 class="font-semibold">Načíst náklad z PDF faktury</h2>
        <p class="mt-2 text-sm text-[#667169]">
          PDF odešleme do OpenAI a ověříme odběratele vůči vybrané firmě. Údaje
          před uložením zkontrolujte.
        </p>
        <input
          ref={fileInput}
          type="file"
          name="pdf"
          form="new-expense"
          accept="application/pdf,.pdf"
          disabled={busy}
          class="mt-4 block w-full text-sm"
          aria-label="PDF faktura"
          onChange={() => {
            setHasFile(Boolean(fileInput.current?.files?.length));
            setProof("");
            setRecipient("");
            setError(null);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={extract}
          class="mt-4 rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Zpracovávám PDF…" : "Načíst a ověřit fakturu"}
        </button>
        {recipient && (
          <p role="status" class="mt-3 text-sm text-[#277a4c]">
            Odběratel ověřen: {recipient}. PDF se připojí při uložení nákladu.
          </p>
        )}
      </section>
      <ExpenseForm
        key={version}
        {...props}
        values={values}
        error={error}
        formId="new-expense"
        multipart
        pdfProof={proof}
        disabled={busy || (hasFile && !proof)}
      />
    </>
  );
}
