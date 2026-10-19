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
    normalizeIban("cz52 2010 0000 0029 0000 0005") ===
      "CZ5220100000002900000005",
    "IBAN was not normalized",
  );
  assert(
    isValidIban("CZ52 2010 0000 0029 0000 0005"),
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
    accountNumber: "2900000005",
    bankCode: "2010",
    iban: "cz52 2010 0000 0029 0000 0005",
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
      accountNumber: "2000145399",
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

const validInput = {
  organizationId: "organization",
  userId: "user",
  name: "Hlavní účet",
  bankName: "",
  accountPrefix: "",
  accountNumber: "2900000005",
  bankCode: "2010",
  iban: "",
  bic: "",
  currency: "CZK",
  isDefault: false,
  isActive: true,
};

Deno.test("domestic account generates IBAN on create and IBAN generates local account on update", async () => {
  const service = new BankAccountService(new FakeBankAccountRepository());
  const created = await service.create(validInput);
  assert(
    created?.iban === "CZ5220100000002900000005",
    "missing generated IBAN",
  );
  const updated = await service.update({
    ...validInput,
    id: "account",
    accountNumber: "",
    bankCode: "",
    iban: "cz52 2010 0000 0029 0000 0005",
  });
  assert(
    updated?.accountNumber === "2900000005" && updated.bankCode === "2010" &&
      updated.accountPrefix === null,
    "missing domestic account",
  );
});

Deno.test("bank account rejects invalid checksums, orphan prefix and conflicting formats", async () => {
  for (
    const changes of [
      { accountNumber: "2900000002" },
      { accountPrefix: "18" },
      { accountNumber: "0000000000" },
      { bankCode: "0000" },
      {
        accountPrefix: "19",
        accountNumber: "",
        bankCode: "",
        iban: "CZ5220100000002900000005",
      },
      { iban: "CZ6508000000192000145399" },
      { iban: "DE89370400440532013000" },
    ]
  ) {
    const repository = new FakeBankAccountRepository();
    let rejected = false;
    try {
      await new BankAccountService(repository).create({
        ...validInput,
        ...changes,
      });
    } catch (error) {
      rejected = error instanceof BankAccountValidationError;
    }
    assert(
      rejected && repository.created === null,
      `accepted ${JSON.stringify(changes)}`,
    );
  }
});

Deno.test("foreign IBAN remains usable without a domestic account", async () => {
  const account = await new BankAccountService(new FakeBankAccountRepository())
    .create({
      ...validInput,
      accountNumber: "",
      bankCode: "",
      iban: "DE89370400440532013000",
    });
  assert(
    account?.accountNumber === null && account.bankCode === null,
    "invented Czech account",
  );
});
