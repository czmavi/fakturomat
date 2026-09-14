import { hashPassword, verifyPassword } from "better-auth/crypto";
import { verifyLegacyPassword } from "@/domain/auth/legacy_password.ts";

const LEGACY_PASSWORD_HASH =
  "pbkdf2_sha256$10000$dypdKfjyUuDYozNjI11SMQ$RRZxByTb0mB9AoX0CvS2cp0e0AMKo9dU3TWPFnvv8iE";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("Better Auth scrypt hashes verify only the original password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert(
    await verifyPassword({ hash, password: "correct horse battery staple" }),
    "valid password rejected",
  );
  assert(
    !await verifyPassword({ hash, password: "different password" }),
    "invalid password accepted",
  );
});

Deno.test("migrated PBKDF2 hashes remain verifiable", async () => {
  assert(
    await verifyLegacyPassword(
      "correct horse battery staple",
      LEGACY_PASSWORD_HASH,
    ),
    "valid legacy password rejected",
  );
  assert(
    !await verifyLegacyPassword("different password", LEGACY_PASSWORD_HASH),
    "invalid legacy password accepted",
  );
  assert(
    !await verifyLegacyPassword("password", "not-a-password-hash"),
    "malformed legacy hash accepted",
  );
});
