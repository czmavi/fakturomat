import type {
  BankAccount,
  NormalizedBankAccountInput,
} from "@/domain/banking/types.ts";
import type { BankAccountRepository } from "@/repositories/bank_account_repository.ts";
import {
  BankAccountService,
  BankAccountValidationError,
  isValidIban,
  normalizeIban,
} from "@/services/bank_account_service.ts";

class FakeBankAccountRepository implements BankAccountRepository {
  created:
    | (NormalizedBankAccountInput & { id: string; organizationId: string })
    | null = null;

  listForUser(
    _organizationId: string,
    _userId: string,
  ): Promise<BankAccount[]> {
    return Promise.resolve([]);
  }

  findForUser(
    _organizationId: string,
    _bankAccountId: string,
    _userId: string,
  ): Promise<BankAccount | null> {
    return Promise.resolve(null);
  }

  createForUser(
    input: NormalizedBankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount> {
    this.created = input;
    return Promise.resolve({ ...input });
  }

  updateForUser(
    input: NormalizedBankAccountInput & {
      id: string;
      organizationId: string;
      userId: string;
    },
  ): Promise<BankAccount> {
    return Promise.resolve({ ...input });
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("IBAN validation normalizes spaces and verifies checksum", () => {
  assert(
    normalizeIban("cz63 2010 0000 0029 0000 0001") ===
      "CZ6320100000002900000001",
    "IBAN was not normalized",
  );
  assert(
    isValidIban("CZ63 2010 0000 0029 0000 0001"),
    "valid IBAN was rejected",
  );
  assert(
    !isValidIban("CZ00 2010 0000 0029 0000 0001"),
    "invalid checksum was accepted",
  );
});

Deno.test("bank account service normalizes optional fields", async () => {
  const repository = new FakeBankAccountRepository();
  const account = await new BankAccountService(repository).create({
    organizationId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    name: " Hlavní účet ",
    bankName: "",
    accountPrefix: "",
    accountNumber: "2900000001",
    bankCode: "2010",
    iban: "cz63 2010 0000 0029 0000 0001",
    bic: "fiobczppxxx",
    currency: "czk",
    isDefault: true,
    isActive: true,
  });
  assert(account?.name === "Hlavní účet", "name was not trimmed");
  assert(
    repository.created?.accountPrefix === null,
    "empty prefix was not normalized to null",
  );
  assert(repository.created?.bic === "FIOBCZPPXXX", "BIC was not normalized");
  assert(repository.created?.currency === "CZK", "currency was not normalized");
});

Deno.test("inactive account cannot be selected as default", async () => {
  let rejected = false;
  try {
    await new BankAccountService(new FakeBankAccountRepository()).create({
      organizationId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      name: "Inactive account",
      bankName: "",
      accountPrefix: "",
      accountNumber: "123456789",
      bankCode: "0100",
      iban: "",
      bic: "",
      currency: "CZK",
      isDefault: true,
      isActive: false,
    });
  } catch (error) {
    rejected = error instanceof BankAccountValidationError;
  }
  assert(rejected, "inactive default account was accepted");
});
