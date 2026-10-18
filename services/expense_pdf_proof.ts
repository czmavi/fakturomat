import { getBetterAuthSecret } from "@/config/env.ts";
import {
  type CompanyIdentity,
  ExpensePdfError,
  type Recipient,
  verifyRecipient,
} from "@/services/expense_pdf_service.ts";
import { sha256Hex } from "@/services/storage/integrity.ts";

async function key() {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getBetterAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function createPdfProof(
  bytes: Uint8Array,
  organizationId: string,
  userId: string,
  recipient: Recipient,
) {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      hash: await sha256Hex(bytes),
      organizationId,
      userId,
      recipient,
      expires: Date.now() + 60 * 60 * 1000,
    }),
  ).toBase64({ alphabet: "base64url", omitPadding: true });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await key(),
      new TextEncoder().encode(payload),
    ),
  ).toBase64({ alphabet: "base64url", omitPadding: true });
  return `${payload}.${signature}`;
}
export async function verifyPdfProof(
  token: string,
  bytes: Uint8Array,
  organizationId: string,
  userId: string,
  company: CompanyIdentity,
) {
  try {
    const [payload, signature, extra] = token.split(".");
    if (
      extra || !payload || !signature ||
      !await crypto.subtle.verify(
        "HMAC",
        await key(),
        Uint8Array.fromBase64(signature, { alphabet: "base64url" }),
        new TextEncoder().encode(payload),
      )
    ) throw new Error();
    const data = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.fromBase64(payload, { alphabet: "base64url" }),
      ),
    );
    if (
      data.organizationId !== organizationId || data.userId !== userId ||
      data.expires <= Date.now() || data.hash !== await sha256Hex(bytes)
    ) throw new Error();
    verifyRecipient(data.recipient, company);
  } catch {
    throw new ExpensePdfError(
      "Ověření PDF vypršelo nebo se změnil soubor či firma. Načtěte fakturu znovu.",
    );
  }
}
