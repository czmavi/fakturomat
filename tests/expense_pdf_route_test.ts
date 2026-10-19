import { App } from "fresh";
import type { State } from "@/utils.ts";
import { withRuntime } from "@/config/runtime.ts";
import { getDb } from "@/database/client.ts";
import { D1OrganizationRepository } from "@/repositories/organization_repository.ts";
import { handler } from "@/routes/o/[organizationId]/expenses/extract.ts";
import { assert, testRuntime } from "./d1_test_helper.ts";

Deno.test("PDF extraction reads Cloudflare bindings and returns a useful JSON error", async () => {
  const env = testRuntime();
  env.OPENAI_API_KEY = "worker-test-key";
  env.OPENAI_EXPENSE_MODEL = "worker-test-model";
  const originalFetch = globalThis.fetch;
  let called = false;
  try {
    await withRuntime(env, async () => {
      const userId = crypto.randomUUID();
      const organizationId = crypto.randomUUID();
      await getDb()`INSERT INTO users(id,email,display_name,email_verified) VALUES (${userId}, 'pdf@example.test', 'Owner', true)`;
      await new D1OrganizationRepository().createWithOwner({
        id: organizationId,
        ownerUserId: userId,
        type: "SRO",
        officialName: "Test firma",
        displayName: "Test",
        ico: "12345678",
      });
      globalThis.fetch = (_url, init) => {
        called = true;
        assert(
          new Headers(init?.headers).get("Authorization") ===
            "Bearer worker-test-key",
        );
        assert(JSON.parse(String(init?.body)).model === "worker-test-model");
        return Promise.resolve(new Response(null, { status: 429 }));
      };
      const app = new App<State>();
      app.use((ctx) => {
        ctx.state.user = { id: userId } as State["user"];
        ctx.state.csrfToken = "test-csrf";
        return ctx.next();
      });
      app.post("/o/:organizationId/expenses/extract", handler.POST);
      const form = new FormData();
      form.set("csrf_token", "test-csrf");
      form.set(
        "pdf",
        new File(["%PDF-1.7\n"], "invoice.pdf", { type: "application/pdf" }),
      );
      const response = await app.handler()(
        new Request(
          `https://fakturomat.test/o/${organizationId}/expenses/extract`,
          { method: "POST", body: form },
        ),
      );
      assert(called, "Worker API configuration was not used");
      assert(response.status === 422);
      assert(
        response.headers.get("content-type")?.includes("application/json"),
      );
      assert((await response.json()).error.includes("limit"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    env.DB.sqlite.close();
  }
});
