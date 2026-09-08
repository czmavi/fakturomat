import { closeDb } from "@/database/client.ts";
import { AuthService } from "@/services/auth_service.ts";
import { PostgresAuthRepository } from "@/repositories/auth_repository.ts";

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

    const service = new AuthService(new PostgresAuthRepository());
    const user = await service.createUser({ email, displayName, password });
    console.log(`Created user ${user.email}.`);
  } finally {
    await closeDb();
  }
}
