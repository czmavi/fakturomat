import { resolveDashboardPeriod } from "@/services/dashboard_period_service.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("dashboard period presets resolve exact calendar boundaries", () => {
  const now = new Date("2026-01-15T12:00:00Z");
  const thisMonth = resolveDashboardPeriod(new URLSearchParams(), now);
  assert(
    thisMonth.preset === "THIS_MONTH" &&
      thisMonth.dateFrom === "2026-01-01" &&
      thisMonth.dateTo === "2026-01-31",
    "current month boundaries are incorrect",
  );

  const lastMonth = resolveDashboardPeriod(
    new URLSearchParams("period=LAST_MONTH"),
    now,
  );
  assert(
    lastMonth.dateFrom === "2025-12-01" &&
      lastMonth.dateTo === "2025-12-31",
    "previous month did not cross the year boundary",
  );

  const thisYear = resolveDashboardPeriod(
    new URLSearchParams("period=THIS_YEAR"),
    now,
  );
  assert(
    thisYear.dateFrom === "2026-01-01" && thisYear.dateTo === "2026-12-31",
    "current year boundaries are incorrect",
  );
});

Deno.test("dashboard custom period accepts only ordered real dates", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const custom = resolveDashboardPeriod(
    new URLSearchParams("period=CUSTOM&from=2026-02-01&to=2026-02-28"),
    now,
  );
  assert(
    custom.preset === "CUSTOM" && custom.dateFrom === "2026-02-01" &&
      custom.dateTo === "2026-02-28",
    "valid custom period was rejected",
  );

  for (
    const query of [
      "period=CUSTOM&from=2026-02-30&to=2026-03-01",
      "period=CUSTOM&from=2026-03-02&to=2026-03-01",
    ]
  ) {
    const fallback = resolveDashboardPeriod(new URLSearchParams(query), now);
    assert(
      fallback.preset === "THIS_MONTH" &&
        fallback.dateFrom === "2026-09-01" &&
        fallback.dateTo === "2026-09-30",
      "invalid custom period did not fall back safely",
    );
  }
});
