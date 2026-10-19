import {
  czechAccountFromIban,
  czechAccountToIban,
  isValidCzechAccount,
  isValidIban,
  normalizeIban,
} from "@/domain/banking/account_number.ts";
export { isValidIban, normalizeIban } from "@/domain/banking/account_number.ts";
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

function validateAndNormalize(
  input: BankAccountInput,
): NormalizedBankAccountInput {
  const name = input.name.trim();
  const bankName = optional(input.bankName);
  let accountPrefix = optional(input.accountPrefix);
  let accountNumber = optional(input.accountNumber);
  let bankCode = optional(input.bankCode);
  const rawIban = optional(input.iban);
  let iban = rawIban ? normalizeIban(rawIban) : null;
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
  if (accountPrefix && !accountNumber) {
    throw new BankAccountValidationError(
      "Předčíslí vyplňte společně s číslem účtu a kódem banky.",
    );
  }
  if (accountNumber && bankCode) {
    if (!isValidCzechAccount(accountPrefix ?? "", accountNumber, bankCode)) {
      throw new BankAccountValidationError(
        "Číslo účtu nebo předčíslí nemá platný kontrolní součet (modulo 11).",
      );
    }
    const calculated = czechAccountToIban(
      accountPrefix ?? "",
      accountNumber,
      bankCode,
    )!;
    if (iban && iban !== calculated) {
      throw new BankAccountValidationError(
        "IBAN neodpovídá zadanému českému číslu účtu.",
      );
    }
    iban = calculated;
  } else if (iban?.startsWith("CZ")) {
    const local = czechAccountFromIban(iban);
    if (!local) {
      throw new BankAccountValidationError(
        "Český IBAN obsahuje neplatné číslo účtu.",
      );
    }
    accountPrefix = local.accountPrefix || null;
    accountNumber = local.accountNumber;
    bankCode = local.bankCode;
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
