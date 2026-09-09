export class CredentialCipherError extends Error {}

interface EncryptedEnvelope {
  version: 1;
  algorithm: "A256GCM";
  iv: string;
  ciphertext: string;
}

function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export class AesGcmCredentialCipher {
  constructor(private readonly rawKey: Uint8Array) {
    if (rawKey.length !== 32) {
      throw new CredentialCipherError("Encryption key must contain 32 bytes.");
    }
  }

  private async key(): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      "raw",
      this.rawKey.slice().buffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async encrypt(plaintext: string, associatedData: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(associatedData),
        tagLength: 128,
      },
      await this.key(),
      encoded,
    );
    const envelope: EncryptedEnvelope = {
      version: 1,
      algorithm: "A256GCM",
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(encrypted)),
    };
    return JSON.stringify(envelope);
  }

  async decrypt(ciphertext: string, associatedData: string): Promise<string> {
    try {
      const envelope = JSON.parse(ciphertext) as Partial<EncryptedEnvelope>;
      if (
        envelope.version !== 1 || envelope.algorithm !== "A256GCM" ||
        typeof envelope.iv !== "string" ||
        typeof envelope.ciphertext !== "string"
      ) {
        throw new Error("Unsupported envelope");
      }
      const iv = fromBase64(envelope.iv);
      if (iv.length !== 12) throw new Error("Invalid IV");
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv.slice(),
          additionalData: new TextEncoder().encode(associatedData),
          tagLength: 128,
        },
        await this.key(),
        fromBase64(envelope.ciphertext).slice().buffer,
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(decrypted);
    } catch (error) {
      if (error instanceof CredentialCipherError) throw error;
      throw new CredentialCipherError("Credentials could not be decrypted.");
    }
  }
}
