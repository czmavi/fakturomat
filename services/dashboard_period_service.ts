import type {
  DashboardPeriod,
  DashboardPeriodPreset,
} from "@/domain/dashboard/types.ts";
import { DASHBOARD_PERIOD_PRESETS } from "@/domain/dashboard/types.ts";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string | null): value is string {
  if (value === null || !ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value;
}

export function currentPragueDate(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function monthBounds(year: number, month: number): [string, string] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

export function resolveDashboardPeriod(
  searchParams: URLSearchParams,
  now = new Date(),
): DashboardPeriod {
  const requested = searchParams.get("period");
  const preset: DashboardPeriodPreset = DASHBOARD_PERIOD_PRESETS.includes(
      requested as DashboardPeriodPreset,
    )
    ? requested as DashboardPeriodPreset
    : "THIS_MONTH";
  const today = currentPragueDate(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  if (preset === "CUSTOM") {
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    if (validIsoDate(dateFrom) && validIsoDate(dateTo) && dateFrom <= dateTo) {
      return { preset, dateFrom, dateTo };
    }
  }
  if (preset === "LAST_MONTH") {
    const previous = new Date(Date.UTC(year, month - 2, 1));
    const [dateFrom, dateTo] = monthBounds(
      previous.getUTCFullYear(),
      previous.getUTCMonth() + 1,
    );
    return { preset, dateFrom, dateTo };
  }
  if (preset === "THIS_YEAR") {
    return {
      preset,
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
    };
  }
  const [dateFrom, dateTo] = monthBounds(year, month);
  return { preset: "THIS_MONTH", dateFrom, dateTo };
}
