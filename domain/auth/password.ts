const ALGORITHM = "PBKDF2";
const HASH_NAME = "SHA-256";
const HASH_LENGTH = 32;
export const DEFAULT_PASSWORD_ITERATIONS = 600_000;
export const MAX_PASSWORD_BYTES = 512;

const encoder = new TextEncoder();

function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return true;
  }
  return false;
}

function encodeBase64Url(value: Uint8Array): string {
  return Uint8Array.from(value).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
}

function decodeBase64Url(value: string): Uint8Array {
  return Uint8Array.fromBase64(value, { alphabet: "base64url" });
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

export async function hashPassword(
  password: string,
  iterations = DEFAULT_PASSWORD_ITERATIONS,
): Promise<string> {
  if (password.length < 12) {
    throw new Error("Password must contain at least 12 characters");
  }
  if (exceedsUtf8ByteLimit(password, MAX_PASSWORD_BYTES)) {
    throw new Error(`Password must not exceed ${MAX_PASSWORD_BYTES} bytes`);
  }
  if (!Number.isInteger(iterations) || iterations < 10_000) {
    throw new Error("Password hash iteration count is too low");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${encodeBase64Url(salt)}$${
    encodeBase64Url(hash)
  }`;
}

export async function verifyPassword(
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
    ) {
      return false;
    }

    const salt = decodeBase64Url(rawSalt);
    const expected = decodeBase64Url(rawExpected);
    if (salt.length !== 16 || expected.length !== HASH_LENGTH) return false;

    const actual = await derivePassword(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}
