import {
  hashPassword,
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
