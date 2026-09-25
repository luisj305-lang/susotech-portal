const NEW_YORK_TIME_ZONE = "America/New_York";

const civilDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getCivilDateParts(referenceAt: Date) {
  const parts = new Map(
    civilDateFormatter
      .formatToParts(referenceAt)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.get("year")!,
    month: parts.get("month")!,
    day: parts.get("day")!,
  };
}

/**
 * Returns a stable instant inside the requested New York civil week.
 * Civil-date arithmetic avoids shifting a Friday reference back to Thursday
 * when a seven-day UTC duration crosses the end of daylight saving time.
 */
export function referenceAtForNewYorkWeek(weekOffset: number, referenceAt = new Date()): string {
  const { year, month, day } = getCivilDateParts(referenceAt);

  return new Date(Date.UTC(year, month - 1, day + weekOffset * 7, 12)).toISOString();
}

/**
 * Returns a New York civil date inside the requested payroll week. This is
 * safe to pass to date-based RPCs without using a fixed UTC seven-day offset.
 */
export function referenceDateForNewYorkWeek(weekOffset: number, referenceAt = new Date()): string {
  return newYorkDateString(new Date(referenceAtForNewYorkWeek(weekOffset, referenceAt)));
}

/**
 * Returns the current Friday–Thursday payroll period boundaries as New York
 * civil dates (`YYYY-MM-DD`). Mirrors the SQL `refresh_hourly_pay_period`
 * computation: Friday opens the period and the following Friday is exclusive.
 * Civil-date arithmetic keeps the boundary anchored even across DST, so a
 * seven-day duration is never added to an instant naively.
 */
export function currentNewYorkPayrollPeriod(referenceAt = new Date()): {
  periodStart: string;
  periodEndExclusive: string;
} {
  const { year, month, day } = getCivilDateParts(referenceAt);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const daysSinceFriday = (weekday + 2) % 7;

  const periodStart = new Date(Date.UTC(year, month - 1, day - daysSinceFriday, 12));
  const periodEndExclusive = new Date(Date.UTC(year, month - 1, day - daysSinceFriday + 7, 12));

  return {
    periodStart: civilDateFormatter.format(periodStart),
    periodEndExclusive: civilDateFormatter.format(periodEndExclusive),
  };
}

/**
 * Current New York civil date (`YYYY-MM-DD`).
 */
export function newYorkDateString(referenceAt = new Date()): string {
  return civilDateFormatter.format(referenceAt);
}
