import { hashPassword } from "better-auth/crypto";
import { getDb } from "@/database/client.ts";
import type { Sql, TransactionSql } from "@/database/d1.ts";
import { isUuid } from "@/domain/organizations/types.ts";

export class UserManagementError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}
export interface ManagedUser {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  is_admin: number;
  organizationIds: string[];
}
export interface UserManagementInput {
  email: string;
  displayName: string;
  password: string;
  organizationIds: string[];
  active: boolean;
}

export class UserManagementService {
  constructor(private readonly sql: Sql = getDb()) {}

  async requireAdmin(actorId: string, sql: Sql = this.sql) {
    const rows =
      await sql`SELECT id FROM users WHERE id = ${actorId} AND is_admin = 1 AND is_active = 1`;
    if (!rows.length) throw new UserManagementError("Přístup odepřen.", 403);
  }

  async list(actorId: string) {
    await this.requireAdmin(actorId);
    const users = await this.sql<Omit<ManagedUser, "organizationIds">[]>`
      SELECT id, email, display_name, is_active, is_admin FROM users ORDER BY lower(display_name), id
    `;
    const organizations = await this.sql<
      { id: string; display_name: string }[]
    >`
      SELECT id, display_name FROM organizations ORDER BY lower(display_name), id
    `;
    const memberships = await this.sql<
      { user_id: string; organization_id: string }[]
    >`
      SELECT user_id, organization_id FROM organization_memberships
    `;
    return {
      users: users.map((user) => ({
        ...user,
        organizationIds: memberships.filter((m) => m.user_id === user.id).map((
          m,
        ) => m.organization_id),
      })),
      organizations,
    };
  }

  private validate(input: UserManagementInput, creating: boolean) {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new UserManagementError("Zadejte platný e-mail.");
    }
    if (!displayName || displayName.length > 120) {
      throw new UserManagementError("Jméno musí mít 1 až 120 znaků.");
    }
    if (
      (creating || input.password !== "") &&
      (input.password.length < 12 || input.password.length > 512)
    ) {
      throw new UserManagementError("Heslo musí mít 12 až 512 znaků.");
    }
    const organizationIds = [...new Set(input.organizationIds)];
    if (
      organizationIds.length > 100 || organizationIds.some((id) => !isUuid(id))
    ) {
      throw new UserManagementError("Neplatný výběr organizací (nejvýše 100).");
    }
    return { ...input, email, displayName, organizationIds };
  }

  private async assign(
    tx: TransactionSql,
    userId: string,
    organizationIds: string[],
  ) {
    const organizations = await tx<
      { id: string }[]
    >`SELECT id FROM organizations`;
    if (organizationIds.some((id) => !organizations.some((o) => o.id === id))) {
      throw new UserManagementError(
        "Některá z vybraných organizací již neexistuje.",
      );
    }
    tx.queue(
      tx`DELETE FROM organization_memberships WHERE user_id = ${userId}`,
    );
    for (const id of organizationIds) {
      tx.queue(
        tx`INSERT INTO organization_memberships (organization_id,user_id,role) VALUES (${id},${userId},'MEMBER')`,
      );
    }
  }

  async save(
    actorId: string,
    targetId: string | null,
    input: UserManagementInput,
  ) {
    await this.requireAdmin(actorId);
    const values = this.validate(input, targetId === null);
    const id = targetId ?? crypto.randomUUID();
    if (!isUuid(id)) {
      throw new UserManagementError("Uživatel nebyl nalezen.", 404);
    }
    const passwordHash = values.password
      ? await hashPassword(values.password)
      : null;
    await this.sql.begin(async (tx) => {
      await this.requireAdmin(actorId, tx);
      if (targetId !== null) {
        const users = await tx<
          { is_admin: number }[]
        >`SELECT is_admin FROM users WHERE id = ${id}`;
        if (!users.length) {
          throw new UserManagementError("Uživatel nebyl nalezen.", 404);
        }
        // Admin access is provisioned explicitly, never through the ordinary user form.
        if (users[0].is_admin === 1) {
          throw new UserManagementError(
            "Účet správce nelze tímto formulářem měnit.",
            403,
          );
        }
      }
      const duplicate =
        await tx`SELECT id FROM users WHERE email = ${values.email} AND id <> ${id}`;
      if (duplicate.length) {
        throw new UserManagementError(
          "Uživatel s tímto e-mailem již existuje.",
        );
      }
      if (targetId === null) {
        tx.queue(
          tx`INSERT INTO users (id,email,display_name,email_verified,is_active,is_admin)
          VALUES (${id},${values.email},${values.displayName},1,${values.active},0)`,
        );
        tx.queue(
          tx`INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password)
          VALUES (${crypto.randomUUID()},${id},'credential',${id},${passwordHash})`,
        );
      } else {
        tx.queue(
          tx`UPDATE users SET email = ${values.email}, display_name = ${values.displayName},
          is_active = ${values.active}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ${id}`,
        );
        if (passwordHash) {
          tx.queue(
            tx`UPDATE auth_accounts SET password = ${passwordHash}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE user_id = ${id} AND provider_id = 'credential'`,
          );
        }
        // Revoke existing sessions after changes to access, identity or password.
        tx.queue(tx`DELETE FROM auth_sessions WHERE user_id = ${id}`);
      }
      await this.assign(tx, id, values.organizationIds);
    });
    return id;
  }
}
