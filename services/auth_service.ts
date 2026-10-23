import { runtime } from "@/config/runtime.ts";
import type { AuthenticatedUser } from "@/domain/auth/types.ts";
import { getAuth } from "@/services/better_auth.ts";

export async function loadAuthState(request: Request): Promise<{
  user: AuthenticatedUser | null;
}> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (session === null || session.user.isActive !== true) return { user: null };
  const account = await runtime().DB.prepare(
    "SELECT is_active, is_admin FROM users WHERE id = ?",
  ).bind(session.user.id).first<{ is_active: number; is_admin: number }>();
  if (account?.is_active !== 1) return { user: null };
  return {
    user: {
      isAdmin: account.is_admin === 1,
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.name,
    },
  };
}
