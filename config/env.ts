export type AppEnvironment = "development" | "test" | "production";

export function getAppEnvironment(): AppEnvironment {
  const value = Deno.env.get("APP_ENV") ?? "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("APP_ENV must be development, test, or production");
  }
  return value;
}

export function requireDatabaseUrl(): string {
  const value = Deno.env.get("DATABASE_URL")?.trim();
  if (!value) {
    throw new Error("Missing required environment variable DATABASE_URL");
  }
  return value;
}

export function getDatabaseMaxConnections(): number {
  const raw = Deno.env.get("DATABASE_MAX_CONNECTIONS") ?? "10";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(
      "DATABASE_MAX_CONNECTIONS must be an integer from 1 to 100",
    );
  }
  return value;
}

export function requireBankCredentialsEncryptionKey(): Uint8Array {
  const encoded = Deno.env.get("BANK_CREDENTIALS_ENCRYPTION_KEY")?.trim();
  if (!encoded) {
    throw new Error(
      "Missing required environment variable BANK_CREDENTIALS_ENCRYPTION_KEY",
    );
  }
  let key: Uint8Array;
  try {
    key = Uint8Array.from(
      atob(encoded),
      (character) => character.charCodeAt(0),
    );
  } catch {
    throw new Error("BANK_CREDENTIALS_ENCRYPTION_KEY must be valid base64");
  }
  if (key.length !== 32) {
    throw new Error(
      "BANK_CREDENTIALS_ENCRYPTION_KEY must decode to exactly 32 bytes",
    );
  }
  return key;
}
