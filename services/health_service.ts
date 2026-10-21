import { runtime } from "@/config/runtime.ts";

export const HEALTH_TIMEOUT_MS = 3000;

export async function healthResponse(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  const checks: Record<string, "pending" | "ok" | "error"> = {
    DB: "pending",
    DOCUMENTS: "pending",
    FILES: "pending",
  };
  let timedOut = false;
  async function probe(name: string, run: () => Promise<unknown>) {
    try {
      await run();
      checks[name] = "ok";
    } catch {
      checks[name] = "error";
      throw new Error("Health dependency failed");
    }
  }
  try {
    await Promise.race([
      Promise.resolve().then(async () => {
        const { DB, DOCUMENTS, FILES } = runtime();
        await Promise.all([
          probe(
            "DB",
            () =>
              DB.prepare("SELECT revision FROM _write_epoch WHERE id = 1")
                .first<{ revision: number }>().then((row) => {
                  if (!row || !Number.isSafeInteger(row.revision)) {
                    throw new Error("Database is not ready");
                  }
                }),
          ),
          // A missing probe object is normal. HEAD checks access without reading a body.
          probe("DOCUMENTS", () => DOCUMENTS.head("__health_probe__")),
          probe("FILES", () => FILES.head("__health_probe__")),
        ]);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            timedOut = true;
            reject(new Error("Health timeout"));
          },
          HEALTH_TIMEOUT_MS,
        );
      }),
    ]);
    return response(true);
  } catch {
    // Never log raw dependency errors: they can contain infrastructure secrets.
    console.warn("Healthcheck failed", {
      reason: timedOut ? "timeout" : "dependency_error",
      elapsedMs: Math.round(performance.now() - started),
      checks: { ...checks },
    });
    return response(false);
  } finally {
    clearTimeout(timer);
  }
}

function response(healthy: boolean): Response {
  return new Response(JSON.stringify({ status: healthy ? "ok" : "error" }), {
    status: healthy ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
