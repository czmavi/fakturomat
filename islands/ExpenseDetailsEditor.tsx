import { useState } from "preact/hooks";
import {
  emptyExpenseDetails,
  type ExpenseDetails,
  type ExpenseItem,
} from "@/domain/expenses/details.ts";
const fieldClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-3 py-2 outline-none focus:border-[#277a4c]";
export default function ExpenseDetailsEditor(
  { initial }: { initial?: ExpenseDetails },
) {
  const details = initial ?? emptyExpenseDetails();
  const [items, setItems] = useState(details.items);
  const [payment, setPayment] = useState(details);
  return (
    <section class="space-y-5">
      <h2 class="text-lg font-semibold">Platební údaje dodavatele</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        {([
          ["accountNumber", "Účet (předčíslí-číslo/kód banky)", 22],
          ["iban", "IBAN", 42],
          ["variableSymbol", "Variabilní symbol", 10],
          ["constantSymbol", "Konstantní symbol", 4],
          ["specificSymbol", "Specifický symbol", 10],
        ] as const).map(([key, label, max]) => (
          <label key={key} class="text-sm">
            <span class="mb-2 block">{label}</span>
            <input
              name={`expense_${key}`}
              value={payment[key]}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setPayment((current) => ({ ...current, [key]: value }));
              }}
              maxlength={max}
              class={fieldClass}
            />
          </label>
        ))}
      </div>
      <h2 class="text-lg font-semibold">Položky faktury</h2>
      <p class="text-sm text-[#667169]">
        Jednotková cena je bez DPH, celkem je včetně DPH. Údaje chybějící na
        dokladu ponechte prázdné.
      </p>
      {items.map((item, index) => (
        <fieldset
          key={index}
          class="grid gap-3 rounded-xl border border-[#dce2dc] p-4 sm:grid-cols-3"
        >
          <legend class="px-2 text-sm font-semibold">
            Položka {index + 1}
          </legend>
          {([
            ["description", "Popis"],
            ["quantity", "Množství"],
            ["unit", "Jednotka"],
            ["unitPrice", "Cena za jednotku bez DPH"],
            ["vatRate", "DPH (%)"],
            ["totalAmount", "Celkem včetně DPH"],
          ] as const).map(([key, label]) => (
            <label
              key={key}
              class={key === "description"
                ? "sm:col-span-3 text-sm"
                : "text-sm"}
            >
              <span class="mb-1 block">{label}</span>
              <input
                name={`item_${key}`}
                value={item[key]}
                maxlength={key === "description" ? 1000 : 30}
                required={key === "description"}
                class={fieldClass}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setItems((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, [key]: value } : row
                    )
                  );
                }}
              />
            </label>
          ))}
          <button
            type="button"
            class="text-left text-sm font-semibold text-[#962f25]"
            onClick={() =>
              setItems((current) => current.filter((_, i) => i !== index))}
          >
            Odebrat položku
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={items.length >= 200}
        class="rounded-xl border border-[#cad2cb] px-4 py-2 font-semibold text-[#277a4c]"
        onClick={() =>
          setItems(
            (current) => [
              ...current,
              {
                description: "",
                quantity: "",
                unit: "",
                unitPrice: "",
                vatRate: "",
                totalAmount: "",
              } satisfies ExpenseItem,
            ],
          )}
      >
        + Přidat položku
      </button>
    </section>
  );
}
