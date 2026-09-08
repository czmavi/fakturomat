import type { Sql } from "postgres";
import { getDb } from "@/database/client.ts";
import type { AuthenticatedUser, StoredUser } from "@/domain/auth/types.ts";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
}

interface SessionUserRow {
  id: string;
  email: string;
  display_name: string;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<StoredUser | null>;
  createUser(input: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<AuthenticatedUser>;
  createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findSessionUser(tokenHash: string): Promise<AuthenticatedUser | null>;
  touchSession(tokenHash: string): Promise<void>;
  revokeSession(tokenHash: string): Promise<void>;
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly sql: Sql = getDb()) {}

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const rows = await this.sql<UserRow[]>`
      SELECT id, email, display_name, password_hash, is_active
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;
    const row = rows[0];
    return row
      ? {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        isActive: row.is_active,
      }
      : null;
  }

  async createUser(input: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<AuthenticatedUser> {
    const rows = await this.sql<SessionUserRow[]>`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (${input.id}, ${input.email}, ${input.displayName}, ${input.passwordHash})
      RETURNING id, email, display_name
    `;
    const row = rows[0];
    return { id: row.id, email: row.email, displayName: row.display_name };
  }

  async createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES (${input.id}, ${input.userId}, ${input.tokenHash}, ${input.expiresAt})
    `;
  }

  async findSessionUser(tokenHash: string): Promise<AuthenticatedUser | null> {
    const rows = await this.sql<SessionUserRow[]>`
      SELECT users.id, users.email, users.display_name
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ${tokenHash}
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > now()
        AND users.is_active = true
      LIMIT 1
    `;
    const row = rows[0];
    return row
      ? { id: row.id, email: row.email, displayName: row.display_name }
      : null;
  }

  async touchSession(tokenHash: string): Promise<void> {
    await this.sql`
      UPDATE sessions
      SET last_seen_at = now()
      WHERE token_hash = ${tokenHash}
        AND last_seen_at < now() - interval '5 minutes'
    `;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.sql`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE token_hash = ${tokenHash}
    `;
  }
}
