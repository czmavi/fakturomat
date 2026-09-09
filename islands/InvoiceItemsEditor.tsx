import { useState } from "preact/hooks";
import {
  formatMoneyForDisplay,
  formatMoneyFromMinorUnits,
  multiplyMoneyByQuantity,
  parseMoneyToMinorUnits,
  parseQuantityToUnits,
} from "@/domain/invoices/money.ts";
import type { InvoiceItemFormInput } from "@/domain/invoices/types.ts";

interface Props {
  initialItems: InvoiceItemFormInput[];
  currency: string;
}

const inputClass =
  "w-full rounded-lg border border-[#cad2cb] bg-white px-3 py-2.5 outline-none focus:border-[#277a4c] focus:ring-2 focus:ring-[#d7eee0]";

function itemTotal(item: InvoiceItemFormInput): bigint | null {
  try {
    return multiplyMoneyByQuantity(
      parseMoneyToMinorUnits(item.unitPrice),
      parseQuantityToUnits(item.quantity),
    );
  } catch {
    return null;
  }
}

export default function InvoiceItemsEditor(props: Props) {
  const [items, setItems] = useState(
    props.initialItems.length > 0
      ? props.initialItems
      : [{ description: "", quantity: "1", unit: "ks", unitPrice: "" }],
  );

  const update = (
    index: number,
    field: keyof InvoiceItemFormInput,
    value: string,
  ) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  };
  const totals = items.map(itemTotal);
  const total = totals.reduce<bigint>(
    (sum, value) => sum + (value ?? 0n),
    0n,
  );

  return (
    <fieldset>
      <div class="flex items-center justify-between gap-4">
        <legend class="text-lg font-semibold">Položky</legend>
        <button
          type="button"
          onClick={() =>
            setItems((current) => [
              ...current,
              { description: "", quantity: "1", unit: "ks", unitPrice: "" },
            ])}
          class="rounded-lg border border-[#bfc9c1] px-3 py-2 text-sm font-semibold hover:bg-[#f1f4f1]"
        >
          + Přidat položku
        </button>
      </div>
      <div class="mt-4 space-y-3">
        {items.map((item, index) => (
          <div
            class="grid gap-3 rounded-xl border border-[#e0e5e1] p-3 lg:grid-cols-[minmax(180px,1fr)_110px_90px_140px_130px_42px] lg:items-end"
            key={index}
          >
            <label>
              <span class="mb-1 block text-xs text-[#667169]">Popis</span>
              <input
                name="item_description"
                value={item.description}
                onInput={(event) =>
                  update(index, "description", event.currentTarget.value)}
                maxlength={500}
                required
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-1 block text-xs text-[#667169]">Množství</span>
              <input
                name="item_quantity"
                value={item.quantity}
                onInput={(event) =>
                  update(index, "quantity", event.currentTarget.value)}
                inputmode="decimal"
                required
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-1 block text-xs text-[#667169]">Jednotka</span>
              <input
                name="item_unit"
                value={item.unit}
                onInput={(event) =>
                  update(index, "unit", event.currentTarget.value)}
                maxlength={30}
                required
                class={inputClass}
              />
            </label>
            <label>
              <span class="mb-1 block text-xs text-[#667169]">
                Cena za jednotku
              </span>
              <input
                name="item_unit_price"
                value={item.unitPrice}
                onInput={(event) =>
                  update(index, "unitPrice", event.currentTarget.value)}
                inputmode="decimal"
                required
                class={inputClass}
              />
            </label>
            <div class="pb-2.5 text-right text-sm font-semibold">
              <span class="mb-1 block text-xs font-normal text-[#667169]">
                Celkem
              </span>
              {totals[index] === null ? "—" : formatMoneyForDisplay(
                formatMoneyFromMinorUnits(totals[index]!),
              )} {props.currency}
            </div>
            <button
              type="button"
              aria-label={`Odebrat položku ${index + 1}`}
              disabled={items.length === 1}
              onClick={() =>
                setItems((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index)
                )}
              class="mb-1 grid size-9 place-items-center rounded-lg text-[#8b4a43] hover:bg-[#fff1ef] disabled:cursor-not-allowed disabled:opacity-30"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div class="mt-5 flex justify-end">
        <div class="min-w-64 rounded-xl bg-[#183e2a] px-5 py-4 text-white">
          <span class="text-xs text-white/70">Celkem bez DPH</span>
          <p class="mt-1 text-xl font-semibold">
            {formatMoneyForDisplay(formatMoneyFromMinorUnits(total))}{" "}
            {props.currency}
          </p>
        </div>
      </div>
    </fieldset>
  );
}
