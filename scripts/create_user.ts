import { hashPassword } from "better-auth/crypto";
import { closeDb, getDb } from "@/database/client.ts";

function argument(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}

if (import.meta.main) {
  try {
    const email = argument("--email") ?? Deno.env.get("FAKTUROMAT_ADMIN_EMAIL");
    const displayName = argument("--name") ??
      Deno.env.get("FAKTUROMAT_ADMIN_NAME");
    const password = Deno.env.get("FAKTUROMAT_ADMIN_PASSWORD");

    if (!email || !displayName || !password) {
      throw new Error(
        "Set FAKTUROMAT_ADMIN_EMAIL, FAKTUROMAT_ADMIN_NAME and FAKTUROMAT_ADMIN_PASSWORD (or pass --email and --name).",
      );
    }

    const normalizedEmail = email.trim().toLocaleLowerCase("en-US");
    const normalizedName = displayName.trim();
    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      throw new Error("Invalid email address");
    }
    if (!normalizedName || normalizedName.length > 120) {
      throw new Error("Invalid display name");
    }
    if (password.length < 12 || password.length > 512) {
      throw new Error("Password must contain 12 to 512 characters");
    }

    const sql = getDb();
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO users (
          id, email, display_name, email_verified, is_active
        ) VALUES (
          ${userId}, ${normalizedEmail}, ${normalizedName}, true, true
        )
      `;
      await transaction`
        INSERT INTO auth_accounts (
          id, account_id, provider_id, user_id, password
        ) VALUES (
          ${crypto.randomUUID()}, ${userId}, 'credential', ${userId},
          ${passwordHash}
        )
      `;
    });
    console.log(`Created user ${normalizedEmail}.`);
  } finally {
    await closeDb();
  }
}
