import type {
  BankConnection,
  BankConnectionWithCredentials,
} from "@/domain/banking/types.ts";
import type { BankConnectionRepository } from "@/repositories/bank_connection_repository.ts";
import {
  BankConnectionService,
} from "@/services/banking/bank_connection_service.ts";
import { BankProviderError } from "@/services/banking/bank_provider.ts";
import {
  AesGcmCredentialCipher,
  CredentialCipherError,
} from "@/services/banking/credential_cipher.ts";
import { FioBankProvider } from "@/services/banking/fio_bank_provider.ts";
import {
  suggestExpensePayments,
} from "@/services/banking/expense_payment_service.ts";
import {
  suggestInvoicePayments,
} from "@/services/banking/invoice_payment_service.ts";
import type {
  BankTransaction,
  ExpensePayment,
  InvoicePayment,
  PaymentExpenseCandidate,
  PaymentInvoiceCandidate,
} from "@/domain/banking/types.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeConnectionRepository implements BankConnectionRepository {
  allowed = true;
  record: BankConnectionWithCredentials | null = null;

  bankAccountExistsForUser(
    _organizationId: string,
    _bankAccountId: string,
    _userId: string,
  ): Promise<boolean> {
    return Promise.resolve(this.allowed);
  }

  findForUser(
    _organizationId: string,
    _bankAccountId: string,
    _userId: string,
  ): Promise<BankConnection | null> {
    if (!this.allowed || !this.record) return Promise.resolve(null);
    const { encryptedCredentials: _, ...connection } = this.record;
    return Promise.resolve(connection);
  }

  findWithCredentialsForUser(
    _organizationId: string,
    _bankAccountId: string,
    _userId: string,
  ): Promise<BankConnectionWithCredentials | null> {
    return Promise.resolve(this.allowed ? this.record : null);
  }

  upsertForUser(input: {
    id: string;
    organizationId: string;
    bankAccountId: string;
    userId: string;
    provider: "FIO";
    encryptedCredentials: string;
    status: "CONFIGURED" | "ACTIVE" | "ERROR" | "DISABLED";
  }): Promise<BankConnection | null> {
    if (!this.allowed) return Promise.resolve(null);
    const now = new Date();
    this.record = {
      id: this.record?.id ?? input.id,
      organizationId: input.organizationId,
      bankAccountId: input.bankAccountId,
      provider: input.provider,
      encryptedCredentials: input.encryptedCredentials,
      status: input.status,
      lastSyncAt: null,
      currentBalance: null,
      balanceCurrency: null,
      balanceDate: null,
      createdAt: this.record?.createdAt ?? now,
      updatedAt: now,
    };
    const { encryptedCredentials: _, ...connection } = this.record!;
    return Promise.resolve(connection);
  }

  deleteForUser(
    _organizationId: string,
    _bankAccountId: string,
    _userId: string,
  ): Promise<boolean> {
    if (!this.allowed || !this.record) return Promise.resolve(false);
    this.record = null;
    return Promise.resolve(true);
  }
}

const scope = {
  organizationId: "40000000-0000-4000-8000-000000000001",
  bankAccountId: "40000000-0000-4000-8000-000000000002",
  userId: "40000000-0000-4000-8000-000000000003",
};
const token = "FioReadOnlyToken1234567890";

Deno.test("AES-GCM credentials require the original tenant context", async () => {
  const cipher = new AesGcmCredentialCipher(new Uint8Array(32).fill(7));
  const encrypted = await cipher.encrypt(token, "organization:account:FIO");
  assert(!encrypted.includes(token), "ciphertext exposes the token");
  assert(
    await cipher.decrypt(encrypted, "organization:account:FIO") === token,
    "credentials did not decrypt",
  );
  let rejected = false;
  try {
    await cipher.decrypt(encrypted, "other-organization:account:FIO");
  } catch (error) {
    rejected = error instanceof CredentialCipherError;
  }
  assert(rejected, "ciphertext was accepted in a different tenant context");
});

Deno.test("bank connection encrypts, retains and disables a Fio token", async () => {
  const repository = new FakeConnectionRepository();
  const service = new BankConnectionService(
    repository,
    new AesGcmCredentialCipher(new Uint8Array(32).fill(11)),
  );
  const connection = await service.configureFio({
    ...scope,
    token,
    enabled: true,
  });
  assert(connection?.status === "CONFIGURED", "connection was not configured");
  assert(
    !repository.record!.encryptedCredentials.includes(token),
    "repository received a plaintext token",
  );
  assert(
    (await service.credentialsForSync(scope))?.token === token,
    "backend could not recover the token",
  );
  const encrypted = repository.record!.encryptedCredentials;
  await service.configureFio({ ...scope, token: "", enabled: false });
  assert(
    repository.record?.encryptedCredentials === encrypted,
    "blank form replaced the existing token",
  );
  assert(
    await service.credentialsForSync(scope) === null,
    "disabled connection exposed credentials for synchronization",
  );
});

Deno.test("Fio provider uses only read-only period GET and parses JSON", async () => {
  let requestedUrl = "";
  let requestedMethod = "";
  const fetcher: typeof fetch = (input, init) => {
    requestedUrl = String(input);
    requestedMethod = init?.method ?? "GET";
    return Promise.resolve(Response.json({
      accountStatement: {
        info: {
          accountId: "2900000001",
          bankId: "2010",
          currency: "CZK",
          iban: "CZ6320100000002900000001",
          openingBalance: 1000,
          closingBalance: 750.5,
        },
        transactionList: {
          transaction: [{
            column22: { value: 1234567890 },
            column0: { value: "2026-09-09+0200" },
            column1: { value: -249.5 },
            column14: { value: "CZK" },
            column2: { value: "123456789" },
            column3: { value: "0100" },
            column10: { value: "Dodavatel s.r.o." },
            column4: { value: "0308" },
            column5: { value: "20260001" },
            column6: { value: null },
            column16: { value: "Úhrada dokladu" },
          }],
        },
      },
    }));
  };
  const result = await new FioBankProvider(fetcher).syncTransactions({
    token,
    dateFrom: "2026-09-01",
    dateTo: "2026-09-09",
  });
  assert(
    requestedMethod === "GET",
    "provider used a write-capable HTTP method",
  );
  assert(
    requestedUrl.startsWith("https://fioapi.fio.cz/v1/rest/periods/") &&
      requestedUrl.endsWith("/transactions.json"),
    "provider used an unexpected endpoint",
  );
  assert(result.closingBalance === "750.5", "statement balance was not parsed");
  assert(
    result.transactions[0].providerTransactionId === "1234567890" &&
      result.transactions[0].bookingDate === "2026-09-09" &&
      result.transactions[0].amount === "-249.5" &&
      result.transactions[0].variableSymbol === "20260001",
    "Fio transaction was not normalized",
  );
});

Deno.test("Fio provider maps the documented 30-second limit safely", async () => {
  const provider = new FioBankProvider(() =>
    Promise.resolve(new Response("conflict", { status: 409 }))
  );
  let error: unknown;
  try {
    await provider.syncTransactions({
      token,
      dateFrom: "2026-09-09",
      dateTo: "2026-09-09",
    });
  } catch (caught) {
    error = caught;
  }
  assert(
    error instanceof BankProviderError && error.kind === "RATE_LIMITED",
    "Fio rate limit was not mapped",
  );
  assert(!String(error).includes(token), "provider error leaked the token");
});

Deno.test("invoice payment suggestions rank deterministic exact signals", () => {
  const transaction: BankTransaction = {
    id: "40000000-0000-4000-8000-000000000010",
    organizationId: scope.organizationId,
    bankAccountId: scope.bankAccountId,
    bankAccountName: "Main",
    provider: "FIO",
    providerTransactionId: "provider-10",
    bookingDate: "2026-09-09",
    amount: "100.0000",
    currency: "CZK",
    counterpartyAccount: null,
    counterpartyBankCode: null,
    counterpartyName: null,
    variableSymbol: "20260001",
    constantSymbol: null,
    specificSymbol: null,
    message: null,
    rawData: {},
    createdAt: new Date(),
  };
  const candidate = (
    id: string,
    variableSymbol: string,
    remainingAmount: string,
  ): PaymentInvoiceCandidate => ({
    id,
    number: id,
    contactName: "Customer",
    variableSymbol,
    currency: "CZK",
    total: remainingAmount,
    paidAmount: "0.0000",
    remainingAmount,
  });
  const suggestions = suggestInvoicePayments(transaction, [], [
    candidate("amount-only", "999", "100.0000"),
    candidate("vs-only", "20260001", "90.0000"),
    candidate("exact", "20260001", "100.0000"),
  ]);
  assert(
    suggestions[0].invoice.id === "exact" &&
      suggestions[0].variableSymbolMatches && suggestions[0].amountMatches,
    "exact suggestion was not ranked first",
  );
  const fullPayment: InvoicePayment = {
    id: "40000000-0000-4000-8000-000000000011",
    organizationId: scope.organizationId,
    invoiceId: "40000000-0000-4000-8000-000000000012",
    invoiceNumber: "2026-0001",
    bankTransactionId: transaction.id,
    amount: "100.0000",
    matchType: "MANUAL",
    createdBy: scope.userId,
    createdAt: new Date(),
  };
  assert(
    suggestInvoicePayments(transaction, [fullPayment], [
      candidate("exact", "20260001", "100.0000"),
    ]).length === 0,
    "fully allocated transaction still received suggestions",
  );
});

Deno.test("expense payment suggestions rank outgoing exact signals", () => {
  const transaction: BankTransaction = {
    id: "40000000-0000-4000-8000-000000000020",
    organizationId: scope.organizationId,
    bankAccountId: scope.bankAccountId,
    bankAccountName: "Main",
    provider: "FIO",
    providerTransactionId: "provider-20",
    bookingDate: "2026-09-09",
    amount: "-100.0000",
    currency: "CZK",
    counterpartyAccount: null,
    counterpartyBankCode: null,
    counterpartyName: "Supplier",
    variableSymbol: "42",
    constantSymbol: null,
    specificSymbol: null,
    message: null,
    rawData: {},
    createdAt: new Date(),
  };
  const candidate = (
    id: string,
    supplierInvoiceNumber: string,
    remainingAmount: string,
  ): PaymentExpenseCandidate => ({
    id,
    supplierName: id,
    supplierInvoiceNumber,
    description: "Expense",
    currency: "CZK",
    totalAmount: remainingAmount,
    paidAmount: "0.0000",
    remainingAmount,
  });
  const suggestions = suggestExpensePayments(transaction, [], [
    candidate("amount-only", "PF-999", "100.0000"),
    candidate("vs-only", "PF-42", "90.0000"),
    candidate("exact", "PF-42", "100.0000"),
  ]);
  assert(
    suggestions[0].expense.id === "exact" &&
      suggestions[0].variableSymbolMatches && suggestions[0].amountMatches,
    "exact expense suggestion was not ranked first",
  );
  const fullPayment: ExpensePayment = {
    id: "40000000-0000-4000-8000-000000000021",
    organizationId: scope.organizationId,
    expenseId: "40000000-0000-4000-8000-000000000022",
    expenseSupplierName: "Supplier",
    expenseDocumentNumber: "PF-42",
    bankTransactionId: transaction.id,
    amount: "100.0000",
    createdBy: scope.userId,
    createdAt: new Date(),
  };
  assert(
    suggestExpensePayments(transaction, [fullPayment], [
      candidate("exact", "PF-42", "100.0000"),
    ]).length === 0,
    "fully allocated outgoing transaction still received suggestions",
  );
});
