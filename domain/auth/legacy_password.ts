import { timingSafeEqual } from "@/domain/auth/timing_safe_equal.ts";

const ALGORITHM = "PBKDF2";
const HASH_NAME = "SHA-256";
const HASH_LENGTH = 32;
const MAX_PASSWORD_BYTES = 512;

const encoder = new TextEncoder();

function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    ALGORITHM,
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: ALGORITHM, hash: HASH_NAME, salt: salt.slice().buffer, iterations },
    key,
    HASH_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

export async function verifyLegacyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (exceedsUtf8ByteLimit(password, MAX_PASSWORD_BYTES)) return false;
  try {
    const [algorithm, rawIterations, rawSalt, rawExpected, extra] = encodedHash
      .split("$");
    if (algorithm !== "pbkdf2_sha256" || extra !== undefined) return false;
    const iterations = Number(rawIterations);
    if (
      !Number.isInteger(iterations) || iterations < 10_000 ||
      iterations > 2_000_000
    ) return false;

    const salt = Uint8Array.fromBase64(rawSalt, { alphabet: "base64url" });
    const expected = Uint8Array.fromBase64(rawExpected, {
      alphabet: "base64url",
    });
    if (salt.length !== 16 || expected.length !== HASH_LENGTH) return false;
    const actual = await derivePassword(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
