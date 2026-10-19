import { useRef, useState } from "preact/hooks";
import {
  assignInvoiceFile,
  prepareInvoiceFile,
} from "@/client/prepare_invoice_file.ts";
import { INVOICE_FILE_ACCEPT } from "@/domain/expenses/files.ts";

export default function ExpenseAttachmentUpload(
  { action, csrfToken }: { action: string; csrfToken: string },
) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  async function select(file?: File) {
    const current = ++version.current;
    setReady(false);
    setError("");
    if (input.current) assignInvoiceFile(input.current, null);
    if (!file) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const prepared = await prepareInvoiceFile(file);
      if (current !== version.current) return;
      if (input.current) assignInvoiceFile(input.current, prepared);
      setReady(true);
    } catch (failure) {
      if (current !== version.current) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Soubor se nepodařilo připravit.",
      );
    } finally {
      if (current === version.current) setBusy(false);
    }
  }
  return (
    <form
      method="post"
      action={action}
      encType="multipart/form-data"
      class="mt-4 space-y-3 rounded-xl bg-[#f5f7f5] p-4"
      onSubmit={(event) => {
        if (busy || !ready) event.preventDefault();
      }}
    >
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <p class="text-sm text-[#667169]">
        PDF, JPG, PNG nebo HEIC/HEIF do 20 MB. HEIC/HEIF se před nahráním
        převede na JPEG.
      </p>
      <input
        ref={input}
        type="file"
        name="attachment"
        accept={INVOICE_FILE_ACCEPT}
        required
        disabled={busy}
        aria-label="Vybrat přílohu nákladu"
        class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#183e2a] file:px-4 file:py-3 file:font-semibold file:text-white"
        onChange={(event) => void select(event.currentTarget.files?.[0])}
      />
      {busy && <p role="status" class="text-sm">Připravuji soubor…</p>}
      {error && <p role="alert" class="text-sm text-[#962f25]">{error}</p>}
      <button
        type="submit"
        disabled={busy || !ready}
        class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Nahrát přílohu
      </button>
    </form>
  );
}
