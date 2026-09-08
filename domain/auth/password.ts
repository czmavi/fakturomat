const ALGORITHM = "PBKDF2";
const HASH_NAME = "SHA-256";
const HASH_LENGTH = 32;
export const DEFAULT_PASSWORD_ITERATIONS = 600_000;

const encoder = new TextEncoder();

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
