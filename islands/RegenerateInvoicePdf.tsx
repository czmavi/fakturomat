import { useRef, useState } from "preact/hooks";

export default function RegenerateInvoicePdf(
  props: { action: string; csrfToken: string },
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        class="rounded-xl border border-[#bfc9c1] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[#f7f9f7]"
      >
        Přegenerovat PDF
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="regenerate-pdf-title"
        aria-describedby="regenerate-pdf-description"
        onCancel={(event) => {
          if (submitting) event.preventDefault();
        }}
        class="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[#dce2dc] bg-white p-6 text-[#18251c] shadow-xl backdrop:bg-black/40"
      >
        <h2 id="regenerate-pdf-title" class="text-xl font-semibold">
          Přegenerovat PDF faktury?
        </h2>
        <p
          id="regenerate-pdf-description"
          class="mt-4 rounded-xl bg-[#fff8e7] p-4 text-sm text-[#765814]"
        >
          Pokud už byla faktura odeslána odběrateli, PDF byste neměli
          přegenerovávat. Nový soubor se může vzhledem lišit od odeslané verze.
        </p>
        <p class="mt-4 text-sm text-[#667169]">
          PDF se vytvoří z uložených údajů vystavené faktury. Číslo, částky a
          ostatní fakturační údaje zůstanou stejné.
        </p>
        <form
          method="post"
          action={props.action}
          onSubmit={(event) => {
            if (submitting) {
              event.preventDefault();
              return;
            }
            setSubmitting(true);
          }}
          class="mt-6 flex flex-wrap justify-end gap-3"
        >
          <input type="hidden" name="csrf_token" value={props.csrfToken} />
          <input type="hidden" name="confirmed" value="yes" />
          <button
            type="button"
            autoFocus
            disabled={submitting}
            onClick={() => dialog.current?.close()}
            class="rounded-xl border border-[#bfc9c1] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            Zrušit
          </button>
          <button
            type="submit"
            disabled={submitting}
            class="rounded-xl bg-[#183e2a] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Generuji PDF…" : "Přegenerovat PDF"}
          </button>
        </form>
      </dialog>
    </>
  );
}
