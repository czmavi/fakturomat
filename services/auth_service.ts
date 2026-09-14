import type { AuthenticatedUser } from "@/domain/auth/types.ts";
import { getAuth } from "@/services/better_auth.ts";

export async function loadAuthState(request: Request): Promise<{
  user: AuthenticatedUser | null;
}> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (session === null || session.user.isActive !== true) return { user: null };
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.name,
    },
  };
}
