import { requireBankCredentialsEncryptionKey } from "@/config/env.ts";
import type {
  BankConnection,
  BankConnectionWithCredentials,
  BankProviderType,
} from "@/domain/banking/types.ts";
import type { BankConnectionRepository } from "@/repositories/bank_connection_repository.ts";
import { AesGcmCredentialCipher } from "@/services/banking/credential_cipher.ts";

interface FioCredentials {
  token: string;
}

export class BankConnectionValidationError extends Error {}
export class BankConnectionCredentialError extends Error {}

function associatedData(input: {
  organizationId: string;
  bankAccountId: string;
  provider: BankProviderType;
}): string {
  return [
    "fakturomat-bank-credentials-v1",
    input.organizationId,
    input.bankAccountId,
    input.provider,
  ].join(":");
}

function normalizeFioToken(value: string): string {
  const token = value.trim();
  if (
    token.length < 16 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new BankConnectionValidationError(
      "Fio API token musí mít 16 až 256 povolených znaků.",
    );
  }
  return token;
}

export class BankConnectionService {
  constructor(
    private readonly repository: BankConnectionRepository,
    private readonly cipher: AesGcmCredentialCipher,
  ) {}

  async configureFio(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
    token: string;
    enabled: boolean;
  }): Promise<BankConnection | null> {
    const existing = await this.repository.findWithCredentialsForUser(
      input.organizationId,
      input.bankAccountId,
      input.userId,
    );
    if (
      existing === null &&
      !await this.repository.bankAccountExistsForUser(
        input.organizationId,
        input.bankAccountId,
        input.userId,
      )
    ) {
      return null;
    }

    let encryptedCredentials = existing?.encryptedCredentials ?? null;
    if (input.token.trim() !== "") {
      const credentials: FioCredentials = {
        token: normalizeFioToken(input.token),
      };
      encryptedCredentials = await this.cipher.encrypt(
        JSON.stringify(credentials),
        associatedData({ ...input, provider: "FIO" }),
      );
    }
    if (encryptedCredentials === null) {
      throw new BankConnectionValidationError("Zadejte Fio API token.");
    }

    return await this.repository.upsertForUser({
      id: existing?.id ?? crypto.randomUUID(),
      organizationId: input.organizationId,
      bankAccountId: input.bankAccountId,
      userId: input.userId,
      provider: "FIO",
      encryptedCredentials,
      status: input.enabled ? "CONFIGURED" : "DISABLED",
    });
  }

  async credentialsForSync(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
  }): Promise<
    { connection: BankConnectionWithCredentials; token: string } | null
  > {
    const connection = await this.repository.findWithCredentialsForUser(
      input.organizationId,
      input.bankAccountId,
      input.userId,
    );
    if (connection === null || connection.status === "DISABLED") return null;
    try {
      const plaintext = await this.cipher.decrypt(
        connection.encryptedCredentials,
        associatedData({ ...input, provider: connection.provider }),
      );
      const credentials = JSON.parse(plaintext) as Partial<FioCredentials>;
      if (typeof credentials.token !== "string") throw new Error();
      return { connection, token: normalizeFioToken(credentials.token) };
    } catch {
      throw new BankConnectionCredentialError(
        "Uložené bankovní přihlašovací údaje nelze načíst.",
      );
    }
  }

  async disconnectFio(input: {
    organizationId: string;
    bankAccountId: string;
    userId: string;
  }): Promise<boolean> {
    return await this.repository.deleteForUser(
      input.organizationId,
      input.bankAccountId,
      input.userId,
    );
  }
}

export function createBankConnectionService(
  repository: BankConnectionRepository,
): BankConnectionService {
  return new BankConnectionService(
    repository,
    new AesGcmCredentialCipher(requireBankCredentialsEncryptionKey()),
  );
}
