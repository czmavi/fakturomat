import type { BankConnectionStatus } from "@/domain/banking/types.ts";

interface Props {
  csrfToken: string;
  connected: boolean;
  status: BankConnectionStatus | null;
  error: string | null;
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function BankConnectionForm(props: Props) {
  return (
    <form method="post" class="mt-7 space-y-6">
      <input type="hidden" name="csrf_token" value={props.csrfToken} />
      <input type="hidden" name="intent" value="configure" />
      {props.error && (
        <div
          role="alert"
          class="rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
        >
          {props.error}
        </div>
      )}
      <label class="block">
        <span class="mb-2 block text-sm font-medium">
          {props.connected ? "Nový Fio API token" : "Fio API token"}
        </span>
        <input
          type="password"
          name="token"
          value=""
          minlength={16}
          maxlength={256}
          required={!props.connected}
          autocomplete="new-password"
          spellcheck={false}
          class={inputClass}
        />
        <span class="mt-2 block text-xs leading-5 text-[#758078]">
          {props.connected
            ? "Pole nechte prázdné, pokud chcete zachovat současný token. Token se z bezpečnostních důvodů nikdy nezobrazuje."
            : "Vložte token s oprávněním pouze ke sledování účtu. Po uložení jej už aplikace nezobrazí."}
        </span>
      </label>
      <label class="flex items-center gap-3 rounded-xl bg-[#f5f7f5] px-4 py-4 text-sm">
        <input
          type="checkbox"
          name="enabled"
          checked={props.status !== "DISABLED"}
          class="size-4 accent-[#277a4c]"
        />
        Připojení je aktivní
      </label>
      <button
        type="submit"
        class="w-full rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b]"
      >
        {props.connected ? "Uložit připojení" : "Připojit Fio účet"}
      </button>
    </form>
  );
}
