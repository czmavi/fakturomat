import { useRef, useState } from "preact/hooks";

export default function DeleteInvoice(
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
        Smazat fakturu
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="delete-invoice-title"
        aria-describedby="delete-invoice-description"
        onCancel={(event) => {
          if (submitting) event.preventDefault();
        }}
        class="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-[#dce2dc] bg-white p-6 text-[#18251c] shadow-xl backdrop:bg-black/40"
      >
        <h2 id="delete-invoice-title" class="text-xl font-semibold">
          Trvale smazat fakturu?
        </h2>
        <p
          id="delete-invoice-description"
          class="mt-4 rounded-xl bg-[#fff8e7] p-4 text-sm text-[#765814]"
        >
          Smazání je nevratné. Odstraní fakturu, její položky, všechny verze PDF
          a párování plateb. Číslo se uvolní pro další fakturu ve stejné číselné
          řadě a roce.
        </p>
        <p class="mt-4 text-sm text-[#667169]">
          Pokud už byla faktura odeslána nebo zaúčtována, nemažte ji. Samotné
          bankovní pohyby zůstanou zachované.
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
            class="rounded-xl bg-[#962f25] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Mažu fakturu…" : "Smazat fakturu"}
          </button>
        </form>
      </dialog>
    </>
  );
}
