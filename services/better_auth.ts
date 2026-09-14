import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import {
  hashPassword as hashBetterAuthPassword,
  verifyPassword as verifyBetterAuthPassword,
} from "better-auth/crypto";
import { Pool } from "pg";
import {
  getAppEnvironment,
  getBetterAuthSecret,
  getBetterAuthUrl,
  getDatabaseMaxConnections,
  requireDatabaseUrl,
} from "@/config/env.ts";
import { verifyLegacyPassword } from "@/domain/auth/legacy_password.ts";

export const SESSION_COOKIE_NAME = "fakturomat.session_token";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

function createBetterAuth() {
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: getDatabaseMaxConnections(),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  authPool = pool;

  return betterAuth({
    appName: "Fakturomat",
    baseURL: getBetterAuthUrl(),
    secret: getBetterAuthSecret(),
    database: pool,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 512,
      password: {
        hash: hashBetterAuthPassword,
        // Migration compatibility only; every newly written hash uses scrypt.
        verify: async ({ hash, password }) =>
          hash.startsWith("pbkdf2_sha256$")
            ? await verifyLegacyPassword(password, hash)
            : await verifyBetterAuthPassword({ hash, password }),
      },
    },
    session: {
      modelName: "auth_sessions",
      expiresIn: SESSION_DURATION_SECONDS,
      disableSessionRefresh: true,
      fields: {
        expiresAt: "expires_at",
        token: "token",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    user: {
      modelName: "users",
      fields: {
        name: "display_name",
        email: "email",
        emailVerified: "email_verified",
        image: "image",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        isActive: {
          type: "boolean",
          required: true,
          defaultValue: true,
          input: false,
          fieldName: "is_active",
        },
      },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        scope: "scope",
        password: "password",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        identifier: "identifier",
        value: "value",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const result = await pool.query<{ is_active: boolean }>(
              "SELECT is_active FROM users WHERE id = $1",
              [session.userId],
            );
            if (!result.rows[0]?.is_active) {
              throw new APIError("FORBIDDEN", {
                message: "User account is inactive",
              });
            }
          },
        },
      },
    },
    advanced: {
      cookiePrefix: "fakturomat",
      useSecureCookies: getAppEnvironment() === "production",
      database: {
        generateId: "uuid",
        joins: true,
      },
    },
    telemetry: { enabled: false },
  });
}

let authInstance: ReturnType<typeof createBetterAuth> | undefined;
let authPool: Pool | undefined;

export function getAuth(): ReturnType<typeof createBetterAuth> {
  authInstance ??= createBetterAuth();
  return authInstance;
}

export async function closeBetterAuthDatabase(): Promise<void> {
  const pool = authPool;
  authPool = undefined;
  authInstance = undefined;
  if (pool !== undefined) await pool.end();
}
