import type {
  BankAccount,
  BankAccountInput,
  NormalizedBankAccountInput,
} from "@/domain/banking/types.ts";
import type { BankAccountRepository } from "@/repositories/bank_account_repository.ts";

export class BankAccountValidationError extends Error {}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeIban(value: string): string {
  return value.replaceAll(/\s+/g, "").toLocaleUpperCase("en-US");
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const numeric = character >= "A"
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function validateAndNormalize(
  input: BankAccountInput,
): NormalizedBankAccountInput {
  const name = input.name.trim();
  const bankName = optional(input.bankName);
  const accountPrefix = optional(input.accountPrefix);
  const accountNumber = optional(input.accountNumber);
  const bankCode = optional(input.bankCode);
  const rawIban = optional(input.iban);
  const iban = rawIban ? normalizeIban(rawIban) : null;
  const rawBic = optional(input.bic);
  const bic = rawBic?.toLocaleUpperCase("en-US") ?? null;
  const currency = input.currency.trim().toLocaleUpperCase("en-US");

  if (name.length < 2 || name.length > 100) {
    throw new BankAccountValidationError("Název účtu musí mít 2 až 100 znaků.");
  }
  if (bankName && bankName.length > 120) {
    throw new BankAccountValidationError("Název banky je příliš dlouhý.");
  }
  if (accountPrefix && !/^[0-9]{1,6}$/.test(accountPrefix)) {
    throw new BankAccountValidationError(
      "Předčíslí může obsahovat nejvýše 6 číslic.",
    );
  }
  if ((accountNumber === null) !== (bankCode === null)) {
    throw new BankAccountValidationError(
      "Číslo účtu a kód banky vyplňte společně.",
    );
  }
  if (accountNumber && !/^[0-9]{1,10}$/.test(accountNumber)) {
    throw new BankAccountValidationError(
      "Číslo účtu může obsahovat nejvýše 10 číslic.",
    );
  }
  if (bankCode && !/^[0-9]{4}$/.test(bankCode)) {
    throw new BankAccountValidationError("Kód banky musí obsahovat 4 číslice.");
  }
  if (iban && !isValidIban(iban)) {
    throw new BankAccountValidationError("IBAN není platný.");
  }
  if (!iban && !accountNumber) {
    throw new BankAccountValidationError("Vyplňte české číslo účtu nebo IBAN.");
  }
  if (bic && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(bic)) {
    throw new BankAccountValidationError("BIC musí mít 8 nebo 11 znaků.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BankAccountValidationError("Měna musí být třípísmenný ISO kód.");
  }
  if (input.isDefault && !input.isActive) {
    throw new BankAccountValidationError("Výchozí účet musí být aktivní.");
  }

  return {
    name,
    bankName,
    accountPrefix,
    accountNumber,
    bankCode,
    iban,
    bic,
    currency,
    isDefault: input.isDefault,
    isActive: input.isActive,
  };
}

export class BankAccountService {
  constructor(private readonly repository: BankAccountRepository) {}

  async create(
    input: BankAccountInput & {
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount | null> {
    return await this.repository.createForUser({
      ...validateAndNormalize(input),
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }

  async update(
    input: BankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount | null> {
    return await this.repository.updateForUser({
      ...validateAndNormalize(input),
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    });
  }
}
