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

