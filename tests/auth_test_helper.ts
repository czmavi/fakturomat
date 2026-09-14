import type { Sql } from "postgres";

export const LEGACY_TEST_PASSWORD_HASH =
  "pbkdf2_sha256$10000$3s_QRWXGI3CWcyANA2fyEg$LzOS-tChgQY4bpl8OsmtugzCIdiwJ9U9TVQppjJ83zs";

export class TestAuthRepository {
  constructor(private readonly sql: Sql) {}

  async createUser(input: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
  }): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO users (
          id, email, display_name, email_verified, is_active
        ) VALUES (
          ${input.id}, ${input.email}, ${input.displayName}, true, true
        )
      `;
      await transaction`
        INSERT INTO auth_accounts (
          id, account_id, provider_id, user_id, password
        ) VALUES (
          ${crypto.randomUUID()}, ${input.id}, 'credential', ${input.id},
          ${input.passwordHash}
        )
      `;
    });
  }
}
