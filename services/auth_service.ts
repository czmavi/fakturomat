import { hashPassword, verifyPassword } from "@/domain/auth/password.ts";
import type { AuthenticatedUser, CreatedSession } from "@/domain/auth/types.ts";
import {
  type AuthRepository,
  PostgresAuthRepository,
} from "@/repositories/auth_repository.ts";
import { getCookie } from "@/services/cookie_service.ts";

export const SESSION_COOKIE_NAME = "fakturomat_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const encoder = new TextEncoder();

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomToken(): string {
  return crypto.getRandomValues(new Uint8Array(32)).toBase64({
    alphabet: "base64url",
    omitPadding: true,
  });
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return new Uint8Array(digest).toHex();
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async authenticate(
    email: string,
    password: string,
  ): Promise<CreatedSession | null> {
    const normalizedEmail = normalizeEmail(email);
    const storedUser = isPlausibleEmail(normalizedEmail)
      ? await this.repository.findUserByEmail(normalizedEmail)
      : null;
    const passwordMatches = await verifyPassword(
      password,
      storedUser?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!storedUser || !storedUser.isActive || !passwordMatches) return null;

    const token = randomToken();
    const sessionTokenHash = await hashSessionToken(token);
    await this.repository.createSession({
      id: crypto.randomUUID(),
      userId: storedUser.id,
      tokenHash: sessionTokenHash,
      expiresAt: new Date(Date.now() + SESSION_DURATION_SECONDS * 1_000),
    });

    return {
      user: {
        id: storedUser.id,
        email: storedUser.email,
        displayName: storedUser.displayName,
      },
      token,
      tokenHash: sessionTokenHash,
    };
  }

  async createUser(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<AuthenticatedUser> {
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    if (!isPlausibleEmail(email)) throw new Error("Invalid email address");
    if (!displayName || displayName.length > 120) {
      throw new Error("Invalid display name");
    }

    return await this.repository.createUser({
      id: crypto.randomUUID(),
      email,
      displayName,
      passwordHash: await hashPassword(input.password),
    });
  }
}

export async function loadAuthState(request: Request): Promise<{
  user: AuthenticatedUser | null;
  sessionTokenHash: string | null;
}> {
  const token = getCookie(request.headers, SESSION_COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { user: null, sessionTokenHash: null };
  }

  const sessionTokenHash = await hashSessionToken(token);
  const repository = new PostgresAuthRepository();
  const user = await repository.findSessionUser(sessionTokenHash);
  if (user !== null) await repository.touchSession(sessionTokenHash);
  return { user, sessionTokenHash: user === null ? null : sessionTokenHash };
}
