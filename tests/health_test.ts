import { App, csrf } from "fresh";
import type { State } from "@/utils.ts";
import { withRuntime } from "@/config/runtime.ts";
import { requestContextMiddleware } from "@/services/request_context_middleware.ts";
import { handler } from "@/routes/health.ts";
import organizationScope from "@/routes/o/[organizationId]/_middleware.ts";
import templateScope from "@/routes/templates/_middleware.ts";
import {
  HEALTH_TIMEOUT_MS,
  healthResponse,
} from "@/services/health_service.ts";
import { assert, testRuntime } from "./d1_test_helper.ts";

function appHandler() {
  const app = new App<State>();
  app.use(csrf());
  app.use(requestContextMiddleware);
  app.get("/health", handler.GET);
  app.get(
    "/o/:organizationId/dashboard",
    organizationScope,
    () => new Response("private"),
  );
  app.get("/templates", templateScope, () => new Response("private"));
  app.get("/health/private", templateScope, () => new Response("private"));
  return app.handler();
}
async function check(response: Response, status: number) {
  assert(response.status === status);
  assert(response.headers.get("content-type") === "application/json");
  assert(response.headers.get("cache-control") === "no-store");
  assert(!response.headers.has("set-cookie"));
  assert(!response.headers.has("location"));
  assert(
    await response.text() ===
      JSON.stringify({ status: status === 200 ? "ok" : "error" }),
  );
}
Deno.test("GET /health is public, uncached, ignores cookies and does not write", async () => {
  const env = testRuntime();
  // Health must work even without auth configuration.
  env.BETTER_AUTH_SECRET = "";
  env.BETTER_AUTH_URL = "invalid";
  const fetch = appHandler();
  const before = env.DB.sqlite.prepare("SELECT total_changes() AS n").get()?.n;
  try {
    for (
      const headers of [{}, { cookie: "fakturomat.session_token=invalid" }]
    ) {
      await check(
        await withRuntime(
          env,
          () =>
            fetch(new Request("https://fakturomat.test/health", { headers })),
        ),
        200,
      );
    }
    assert(
      env.DB.sqlite.prepare("SELECT total_changes() AS n").get()?.n === before,
    );
    assert(env.DOCUMENTS.objects.size === 0 && env.FILES.objects.size === 0);
  } finally {
    env.DB.sqlite.close();
  }
});
Deno.test("health failure is generic even when database throws sensitive details", async () => {
  const env = testRuntime();
  env.DB.prepare = () => {
    throw new Error("secret database detail");
  };
  try {
    await check(
      await withRuntime(
        env,
        () => appHandler()(new Request("https://fakturomat.test/health")),
      ),
      503,
    );
  } finally {
    env.DB.sqlite.close();
  }
});
Deno.test("health rejects an uninitialized schema", async () => {
  const env = testRuntime();
  env.DB.sqlite.exec("DELETE FROM _write_epoch");
  try {
    await check(await withRuntime(env, healthResponse), 503);
  } finally {
    env.DB.sqlite.close();
  }
});
for (const binding of ["DOCUMENTS", "FILES"] as const) {
  Deno.test(`health fails when ${binding} is unavailable`, async () => {
    const env = testRuntime();
    env[binding].head = () =>
      Promise.reject(new Error("private infrastructure detail"));
    try {
      await check(await withRuntime(env, healthResponse), 503);
    } finally {
      env.DB.sqlite.close();
    }
  });
}
Deno.test("health returns 503 within a short deadline for a stalled dependency", async () => {
  const env = testRuntime();
  env.DOCUMENTS.head = () => new Promise(() => {});
  const started = performance.now();
  try {
    await check(await withRuntime(env, healthResponse), 503);
    assert(performance.now() - started < HEALTH_TIMEOUT_MS + 1000);
  } finally {
    env.DB.sqlite.close();
  }
});
Deno.test("organization, templates and health subpaths remain protected without authentication", async () => {
  const env = testRuntime();
  const fetch = appHandler();
  try {
    for (
      const path of [
        "/o/10000000-0000-4000-8000-000000000001/dashboard",
        "/templates",
        "/health/private",
      ]
    ) {
      const response = await withRuntime(
        env,
        () => fetch(new Request(`https://fakturomat.test${path}`)),
      );
      assert(response.status >= 300 && response.status < 400);
      assert(response.headers.get("location") === "/login");
      await response.body?.cancel();
    }
  } finally {
    env.DB.sqlite.close();
  }
});
