import { hashPassword } from "better-auth/crypto";
import { sqlLiteral } from "./export_postgres_to_d1.ts";

if (import.meta.main) {
  const email = Deno.env.get("FAKTUROMAT_ADMIN_EMAIL")?.trim().toLowerCase();
  const name = Deno.env.get("FAKTUROMAT_ADMIN_NAME")?.trim();
  const password = Deno.env.get("FAKTUROMAT_ADMIN_PASSWORD");
  const index = Deno.args.indexOf("--output");
  const output = index >= 0 ? Deno.args[index + 1] : undefined;
  if (
    !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !name || name.length > 120 || !password || password.length < 12 ||
    password.length > 512 || !output
  ) {
    throw new Error(
      "Set FAKTUROMAT_ADMIN_EMAIL, FAKTUROMAT_ADMIN_NAME, FAKTUROMAT_ADMIN_PASSWORD (12–512 characters), and pass --output /secure/path/user.sql",
    );
  }
  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  const script =
    `INSERT INTO users (id,email,display_name,email_verified,is_active) VALUES (${
      sqlLiteral(id)
    },${sqlLiteral(email)},${
      sqlLiteral(name)
    },1,1);\nINSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES (${
      sqlLiteral(crypto.randomUUID())
    },${sqlLiteral(id)},'credential',${sqlLiteral(id)},${sqlLiteral(hash)});\n`;
  const file = await Deno.open(output, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    await file.write(new TextEncoder().encode(script));
  } finally {
    file.close();
  }
  console.log(
    "Created bootstrap SQL. Import it into D1, then remove the file and bootstrap password.",
  );
}
