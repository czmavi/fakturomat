import {
  hashPassword,
  MAX_PASSWORD_BYTES,
  timingSafeEqual,
  verifyPassword,
} from "@/domain/auth/password.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("password hashes verify only the original password", async () => {
  const hash = await hashPassword("correct horse battery staple", 10_000);
  assert(
    await verifyPassword("correct horse battery staple", hash),
    "valid password rejected",
  );
  assert(
    !await verifyPassword("different password", hash),
    "invalid password accepted",
  );
});

Deno.test("malformed password hashes are rejected", async () => {
  assert(
    !await verifyPassword("any password here", "not-a-password-hash"),
    "malformed hash accepted",
  );
});

Deno.test("passwords are limited to 512 UTF-8 bytes", async () => {
  const exactAsciiLimit = "a".repeat(MAX_PASSWORD_BYTES);
  const exactMultibyteLimit = "č".repeat(MAX_PASSWORD_BYTES / 2);
  const hash = await hashPassword(exactAsciiLimit, 10_000);
  const multibyteHash = await hashPassword(exactMultibyteLimit, 10_000);
  assert(
    await verifyPassword(exactAsciiLimit, hash),
    "password at the byte limit was rejected",
  );
  assert(
    await verifyPassword(exactMultibyteLimit, multibyteHash),
    "multibyte password at the byte limit was rejected",
  );

  for (const oversized of [`${exactAsciiLimit}a`, `${exactMultibyteLimit}č`]) {
    let hashRejected = false;
    try {
      await hashPassword(oversized, 10_000);
    } catch {
      hashRejected = true;
    }
    assert(hashRejected, "oversized password was hashed");
    assert(
      !await verifyPassword(oversized, multibyteHash),
      "oversized password reached verification",
    );
  }
});

Deno.test("timingSafeEqual handles equal and unequal lengths", () => {
  assert(
    timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])),
    "equal values rejected",
  );
  assert(
    !timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])),
    "unequal values accepted",
  );
  assert(
    !timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 0])),
    "unequal lengths accepted",
  );
});
