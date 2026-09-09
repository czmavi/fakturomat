import { useState } from "preact/hooks";
import {
  formatMoneyForDisplay,
  formatMoneyFromMinorUnits,
  parseMoneyToMinorUnits,
} from "@/domain/invoices/money.ts";
import type { ExpenseVatLineFormInput } from "@/domain/expenses/types.ts";
import { sumVatLines } from "@/domain/expenses/vat.ts";

interface Props {
  initialLines: ExpenseVatLineFormInput[];
  initialTotalAmount: string;
  currency: string;
}

const inputClass =
  "w-full rounded-lg border border-[#cad2cb] bg-white px-3 py-2.5 outline-none focus:border-[#277a4c] focus:ring-2 focus:ring-[#d7eee0]";

function parsedTotals(lines: ExpenseVatLineFormInput[]) {
  try {
    const totals = sumVatLines(lines);
    return {
      base: totals.baseMinorUnits,
      vat: totals.vatMinorUnits,
    };
  } catch {
    return null;
  }
}

function display(value: bigint): string {
  return formatMoneyForDisplay(formatMoneyFromMinorUnits(value));
}

export default function ExpenseVatLinesEditor(props: Props) {
  const [lines, setLines] = useState(props.initialLines);
  const [totalAmount, setTotalAmount] = useState(props.initialTotalAmount);
  const update = (
    index: number,
    field: keyof ExpenseVatLineFormInput,
    value: string,
  ) => {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line
      )
    );
  };
  const totals = parsedTotals(lines);
  let enteredTotal: bigint | null = null;
  try {
    enteredTotal = parseMoneyToMinorUnits(totalAmount);
  } catch {
    // The server performs authoritative validation after submit.
  }
  const difference = totals !== null && enteredTotal !== null
    ? totals.base + totals.vat - enteredTotal
    : null;

  return (
    <fieldset class="space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <legend class="text-lg font-semibold">DPH na dokladu</legend>
          <p class="mt-1 text-sm text-[#667169]">
            Hodnoty jsou pouze evidenční a lze je zadat přesně podle dokladu.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setLines((current) => [
              ...current,
              { vatRate: "21", baseAmount: "", vatAmount: "" },
            ])}
          class="rounded-lg border border-[#bfc9c1] px-3 py-2 text-sm font-semibold hover:bg-[#f1f4f1]"
        >
          + Přidat sazbu
        </button>
      </div>

      <datalist id="vat-rate-presets">
        <option value="21" />
        <option value="12" />
        <option value="0" />
      </datalist>

      {lines.length === 0
        ? (
          <div class="rounded-xl border border-dashed border-[#cbd3cc] px-5 py-6 text-center text-sm text-[#667169]">
            Doklad nemá zadaný rozpis DPH.
          </div>
        )
        : (
          <div class="space-y-3">
            {lines.map((line, index) => (
              <div
                key={index}
                class="grid gap-3 rounded-xl border border-[#e0e5e1] p-3 sm:grid-cols-[120px_1fr_1fr_42px] sm:items-end"
              >
                <label>
                  <span class="mb-1 block text-xs text-[#667169]">
                    Sazba DPH %
                  </span>
                  <input
                    name="vat_rate"
                    value={line.vatRate}
                    onInput={(event) =>
                      update(index, "vatRate", event.currentTarget.value)}
                    inputmode="decimal"
                    list="vat-rate-presets"
                    required
                    class={inputClass}
                  />
                </label>
                <label>
                  <span class="mb-1 block text-xs text-[#667169]">
                    Základ
                  </span>
                  <input
                    name="vat_base_amount"
                    value={line.baseAmount}
                    onInput={(event) =>
                      update(index, "baseAmount", event.currentTarget.value)}
                    inputmode="decimal"
                    required
                    class={inputClass}
                  />
                </label>
                <label>
                  <span class="mb-1 block text-xs text-[#667169]">DPH</span>
                  <input
                    name="vat_amount"
                    value={line.vatAmount}
                    onInput={(event) =>
                      update(index, "vatAmount", event.currentTarget.value)}
                    inputmode="decimal"
                    required
                    class={inputClass}
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Odebrat sazbu ${index + 1}`}
                  onClick={() =>
                    setLines((current) =>
                      current.filter((_, lineIndex) => lineIndex !== index)
                    )}
                  class="mb-1 grid size-9 place-items-center rounded-lg text-[#8b4a43] hover:bg-[#fff1ef]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl bg-[#edf3ee] px-4 py-3">
          <span class="text-xs text-[#667169]">Součet základů</span>
          <p class="mt-1 font-semibold">
            {totals === null ? "—" : display(totals.base)} {props.currency}
          </p>
        </div>
        <div class="rounded-xl bg-[#edf3ee] px-4 py-3">
          <span class="text-xs text-[#667169]">Součet DPH</span>
          <p class="mt-1 font-semibold">
            {totals === null ? "—" : display(totals.vat)} {props.currency}
          </p>
        </div>
        <label class="rounded-xl bg-[#183e2a] px-4 py-3 text-white">
          <span class="block text-xs text-white/70">Celková částka</span>
          <input
            name="total_amount"
            value={totalAmount}
            onInput={(event) => setTotalAmount(event.currentTarget.value)}
            inputmode="decimal"
            required
            class="mt-1 w-full border-b border-white/35 bg-transparent py-1 text-lg font-semibold outline-none focus:border-white"
            placeholder="0,00"
          />
        </label>
      </div>

      {lines.length > 0 && difference !== null && difference !== 0n && (
        <div
          role="status"
          class="rounded-xl border border-[#ead39f] bg-[#fff9e9] px-4 py-3 text-sm text-[#775817]"
        >
          Součet základů a DPH se od celkové částky liší o {display(
            difference < 0n ? -difference : difference,
          )} {props.currency}. Doklad lze přesto uložit.
        </div>
      )}
    </fieldset>
  );
}
