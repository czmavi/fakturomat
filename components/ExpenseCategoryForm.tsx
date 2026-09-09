import type { ExpenseCategoryInput } from "@/domain/expenses/types.ts";

export interface ExpenseCategoryFormProps {
  values: ExpenseCategoryInput;
  csrfToken: string;
  error: string | null;
  submitLabel: string;
}

export const EMPTY_EXPENSE_CATEGORY: ExpenseCategoryInput = {
  name: "",
  isActive: true,
};

export function expenseCategoryInputFromForm(
  form: FormData,
): ExpenseCategoryInput {
  return {
    name: String(form.get("name") ?? ""),
    isActive: form.has("is_active"),
  };
}

const inputClass =
  "w-full rounded-xl border border-[#cad2cb] bg-white px-4 py-3 outline-none focus:border-[#277a4c] focus:ring-3 focus:ring-[#d7eee0]";

export default function ExpenseCategoryForm(
  props: ExpenseCategoryFormProps,
) {
  return (
    <form method="post" class="mt-7 space-y-6">
      <input type="hidden" name="csrf_token" value={props.csrfToken} />
      {props.error && (
        <div
          role="alert"
          class="rounded-xl border border-[#efc7c1] bg-[#fff5f3] px-4 py-3 text-sm text-[#962f25]"
        >
          {props.error}
        </div>
      )}
      <label class="block">
        <span class="mb-2 block text-sm font-medium">Název kategorie</span>
        <input
          name="name"
          value={props.values.name}
          maxlength={100}
          required
          class={inputClass}
          placeholder="Například Pojištění"
        />
      </label>
      <label class="flex items-center gap-3 rounded-xl bg-[#f5f7f5] px-4 py-4 text-sm">
        <input
          type="checkbox"
          name="is_active"
          checked={props.values.isActive}
          class="size-4 accent-[#277a4c]"
        />
        Aktivní kategorie
      </label>
      <button
        type="submit"
        class="w-full rounded-xl bg-[#183e2a] px-5 py-3 font-semibold text-white hover:bg-[#23583b]"
      >
        {props.submitLabel}
      </button>
    </form>
  );
}
