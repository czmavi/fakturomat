import { App } from "fresh";
import { DatabaseSync } from "node:sqlite";
import { verifyPassword } from "better-auth/crypto";
import { withRuntime } from "@/config/runtime.ts";
import { getDb } from "@/database/client.ts";
import {
  UserManagementError,
  UserManagementService,
} from "@/services/user_management_service.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { getAuth } from "@/services/better_auth.ts";
import { loadAuthState } from "@/services/auth_service.ts";
import { handler as users } from "@/routes/users/index.tsx";
import { handler as newOrganization } from "@/routes/organizations/new.tsx";
import scope from "@/routes/o/[organizationId]/_middleware.ts";
import type { State } from "@/utils.ts";
import { assert, testRuntime } from "./d1_test_helper.ts";

async function rejects(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof UserManagementError && error.status === status);
    return;
  }
  throw new Error("Expected rejection");
}
const input = {
  email: " MEMBER@example.test ",
  displayName: " New member ",
  password: "strong-test-password",
  organizationIds: [] as string[],
  active: true,
};

Deno.test("user administration creates credentials, restricts tenants, revokes sessions and rejects escalation", async () => {
  const env = testRuntime();
  try {
    await withRuntime(env, async () => {
      const sql = getDb();
      const admin = crypto.randomUUID();
      await sql`INSERT INTO users(id,email,display_name,is_admin) VALUES (${admin},'admin@example.test','Admin',1)`;
      const orgs = new D1OrganizationRepository();
      const a = await orgs.createWithOwner({
        id: crypto.randomUUID(),
        type: "SRO",
        officialName: "A s.r.o.",
        displayName: "A",
        ownerUserId: admin,
      });
      const b = await orgs.createWithOwner({
        id: crypto.randomUUID(),
        type: "SRO",
        officialName: "B s.r.o.",
        displayName: "B",
        ownerUserId: admin,
      });
      const service = new UserManagementService();
      const id = await service.save(admin, null, {
        ...input,
        organizationIds: [a.id, a.id],
      });
      const account = (await sql<
        { password: string }[]
      >`SELECT password FROM auth_accounts WHERE user_id = ${id}`)[0];
      assert(account.password !== input.password);
      assert(
        await verifyPassword({
          hash: account.password,
          password: input.password,
        }),
      );
      const member = (await service.list(admin)).users.find((u) =>
        u.id === id
      )!;
      assert(member.email === "member@example.test" && member.is_admin === 0);
      assert(member.organizationIds.length === 1);
      assert((await orgs.listForUser(id)).length === 1);
      assert(await orgs.findForUser(b.id, id) === null);
      await rejects(() => service.list(id), 403);
      await rejects(
        () => service.save(id, id, { ...input, organizationIds: [b.id] }),
        403,
      );
      await rejects(() => service.save(admin, admin, input), 403);
      await rejects(() => service.save(admin, null, input), 422);
      const count =
        (await sql<{ n: number }[]>`SELECT count(*) AS n FROM users`)[0].n;
      await rejects(
        () =>
          service.save(admin, null, {
            ...input,
            email: "invalid-org@example.test",
            organizationIds: [crypto.randomUUID()],
          }),
        422,
      );
      assert(
        (await sql<{ n: number }[]>`SELECT count(*) AS n FROM users`)[0].n ===
          count,
        "failed creation must be atomic",
      );

      const auth = getAuth();
      const login = await auth.handler(
        new Request("http://fakturomat.test/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://fakturomat.test",
          },
          body: JSON.stringify({
            email: member.email,
            password: input.password,
          }),
        }),
      );
      assert(login.status === 200);
      const cookie = login.headers.get("set-cookie")!;
      await login.body?.cancel();
      const request = new Request("http://fakturomat.test/dashboard", {
        headers: { cookie },
      });
      assert((await loadAuthState(request)).user?.isAdmin === false);
      await service.save(admin, id, {
        ...input,
        password: "",
        organizationIds: [b.id],
      });
      assert(
        (await loadAuthState(request)).user === null,
        "access change must revoke sessions",
      );
      assert(await orgs.findForUser(a.id, id) === null);
      assert((await orgs.listForUser(id))[0].id === b.id);
      assert(
        (await sql<
          { password: string }[]
        >`SELECT password FROM auth_accounts WHERE user_id = ${id}`)[0]
          .password === account.password,
      );
      await service.save(admin, id, {
        ...input,
        password: "replacement-password",
        active: false,
      });
      const denied = await auth.handler(
        new Request("http://fakturomat.test/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://fakturomat.test",
          },
          body: JSON.stringify({
            email: member.email,
            password: "replacement-password",
          }),
        }),
      );
      assert(denied.status !== 200);
      await denied.body?.cancel();
      assert((await orgs.listForUser(admin)).length === 2);
      await rejects(
        () =>
          service.save(admin, null, {
            ...input,
            email: "short@example.test",
            password: "short",
          }),
        422,
      );
      // New organizations also reach every admin, even if created with another owner internally.
      await orgs.createWithOwner({
        id: crypto.randomUUID(),
        type: "SRO",
        officialName: "C s.r.o.",
        displayName: "C",
        ownerUserId: id,
      });
      assert((await orgs.listForUser(admin)).length === 3);
    });
  } finally {
    env.DB.sqlite.close();
  }
});

Deno.test("HTTP user management, organization creation and foreign organization URLs enforce access and CSRF", async () => {
  const env = testRuntime();
  try {
    await withRuntime(env, async () => {
      const sql = getDb(),
        admin = crypto.randomUUID(),
        member = crypto.randomUUID();
      await sql`INSERT INTO users(id,email,display_name,is_admin) VALUES (${admin},'admin@example.test','Admin',1)`;
      await sql`INSERT INTO users(id,email,display_name) VALUES (${member},'member@example.test','Member')`;
      const org = await new D1OrganizationRepository().createWithOwner({
        id: crypto.randomUUID(),
        type: "SRO",
        officialName: "Private",
        displayName: "Private",
        ownerUserId: admin,
      });
      let actor: State["user"] = null;
      const app = new App<State>();
      app.use((ctx) => {
        ctx.state.user = actor;
        ctx.state.csrfToken = "expected-token";
        return ctx.next();
      });
      app.get("/users", async (ctx) => {
        const response = await users.GET(ctx);
        assert(response instanceof Response);
        return response;
      });
      app.post("/users", async (ctx) => {
        const response = await users.POST(ctx);
        assert(response instanceof Response);
        return response;
      });
      app.get("/organizations/new", async (ctx) => {
        assert(typeof newOrganization !== "function" && !!newOrganization.GET);
        const response = await newOrganization.GET(ctx);
        assert(response instanceof Response);
        return response;
      });
      app.post("/organizations/new", async (ctx) => {
        assert(typeof newOrganization !== "function" && !!newOrganization.POST);
        const response = await newOrganization.POST(ctx);
        assert(response instanceof Response);
        return response;
      });
      app.get(
        "/o/:organizationId/dashboard",
        scope,
        () => new Response("private"),
      );
      const fetch = app.handler();
      for (const method of ["GET", "POST"]) {
        const response = await fetch(
          new Request("http://fakturomat.test/users", { method }),
        );
        assert(response.headers.get("location") === "/login");
        await response.body?.cancel();
      }
      actor = {
        id: member,
        email: "member@example.test",
        displayName: "Member",
        isAdmin: false,
      };
      for (const path of ["/users", "/organizations/new"]) {
        for (const method of ["GET", "POST"]) {
          const response = await fetch(
            new Request(`http://fakturomat.test${path}`, { method }),
          );
          assert(response.status === 403);
          await response.body?.cancel();
        }
      }
      const foreign = await fetch(
        new Request(`http://fakturomat.test/o/${org.id}/dashboard`),
      );
      assert(foreign.status === 404);
      await foreign.body?.cancel();
      actor = {
        id: admin,
        email: "admin@example.test",
        displayName: "Admin",
        isAdmin: true,
      };
      const badCsrf = await fetch(
        new Request("http://fakturomat.test/users", {
          method: "POST",
          body: new URLSearchParams({ csrf_token: "wrong" }),
        }),
      );
      assert(badCsrf.status === 403);
      await badCsrf.body?.cancel();
      // A forged role field does not promote a user.
      const created = await fetch(
        new Request("http://fakturomat.test/users", {
          method: "POST",
          body: new URLSearchParams({
            csrf_token: "expected-token",
            email: "new@example.test",
            display_name: "New",
            password: input.password,
            active: "1",
            is_admin: "1",
            organization_id: org.id,
          }),
        }),
      );
      assert(created.status === 303);
      await created.body?.cancel();
      const row = (await sql<
        { is_admin: number }[]
      >`SELECT is_admin FROM users WHERE email = 'new@example.test'`)[0];
      assert(row.is_admin === 0);
    });
  } finally {
    env.DB.sqlite.close();
  }
});

Deno.test("migration promotes only the designated existing account and grants all existing organizations", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (
      const file of [
        "0001_schema.sql",
        "0002_integrity.sql",
        "0003_expense_details.sql",
      ]
    ) {
      db.exec(
        Deno.readTextFileSync(
          new URL(`../migrations/d1/${file}`, import.meta.url),
        ),
      );
    }
    db.exec(
      "INSERT INTO users(id,email,display_name) VALUES ('admin','mail@martinvich.net','Admin'),('other','other@example.test','Other')",
    );
    db.exec(
      "INSERT INTO organizations(id,type,official_name,display_name) VALUES ('org','SRO','Org','Org')",
    );
    db.exec(
      Deno.readTextFileSync(
        new URL("../migrations/d1/0004_user_management.sql", import.meta.url),
      ),
    );
    assert(
      db.prepare("SELECT is_admin FROM users WHERE id='admin'").get()
        ?.is_admin === 1,
    );
    assert(
      db.prepare("SELECT is_admin FROM users WHERE id='other'").get()
        ?.is_admin === 0,
    );
    assert(
      db.prepare(
        "SELECT role FROM organization_memberships WHERE user_id='admin' AND organization_id='org'",
      ).get()?.role === "OWNER",
    );
    assert(
      db.prepare(
        "SELECT count(*) AS n FROM organization_memberships WHERE user_id='other'",
      ).get()?.n === 0,
    );
  } finally {
    db.close();
  }
});
