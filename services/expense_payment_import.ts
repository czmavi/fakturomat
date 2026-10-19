import {
  emptyExpenseDetails,
  normalizeExpenseDetails,
} from "@/domain/expenses/details.ts";

interface PaymentAccount {
  accountNumber: string;
  iban: string;
}

// Import tolerates transcription errors so the invoice can be reviewed.
// Saving still uses the strict domain validator.
export function prepareImportedPayment(
  input: PaymentAccount,
): PaymentAccount & { warnings: string[] } {
  const normalize = (account: PaymentAccount): PaymentAccount | null => {
    try {
      const result = normalizeExpenseDetails({
        ...emptyExpenseDetails(),
        ...account,
      });
      return { accountNumber: result.accountNumber, iban: result.iban };
    } catch {
      return null;
    }
  };
  const complete = normalize(input);
  if (complete) return { ...complete, warnings: [] };
  // Escape non-ASCII characters so invisible extraction artifacts are inspectable.
  const visible = (value: string) =>
    JSON.stringify(value).replace(
      /[^\x20-\x7e]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  const original = ` Původní výstup AI: účet ${
    visible(input.accountNumber)
  }, IBAN ${visible(input.iban)}.`;
  const local = input.accountNumber.trim()
    ? normalize({ accountNumber: input.accountNumber, iban: "" })
    : null;
  const international = input.iban.trim()
    ? normalize({ accountNumber: "", iban: input.iban })
    : null;
  if (local && !international) {
    return {
      ...local,
      warnings: [
        "IBAN načtený AI nebyl platný. Byl vypočten z českého čísla účtu s platným kontrolním součtem. Před platbou porovnejte účet s fakturou." +
        original,
      ],
    };
  }
  if (international && !local) {
    return {
      ...international,
      warnings: [
        "Číslo účtu načtené AI nebylo platné. Platební údaje byly převzaty z platného IBANu. Před platbou je porovnejte s fakturou." +
        original,
      ],
    };
  }
  return {
    ...input,
    warnings: [
      (local && international
        ? "Číslo účtu a IBAN načtené AI označují různé účty. Před uložením opravte platební údaje podle faktury; žádný účet nebyl automaticky vybrán."
        : "Platební účet načtený AI není platný. Faktura je načtená; před uložením opravte účet/IBAN podle PDF, případně obě pole vymažte a doplňte později.") +
      original,
    ],
  };
}
