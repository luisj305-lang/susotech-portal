const timeZone = "America/New_York";

function computeFallbackWeekRange(referenceAt: Date): {
  start: Date;
  endExclusive: Date;
} {
  const day = referenceAt.getDay();
  const daysSinceFriday = (day - 5 + 7) % 7;
  const start = new Date(referenceAt);
  start.setDate(start.getDate() - daysSinceFriday);
  start.setHours(0, 0, 0, 0);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + 7);
  return { start, endExclusive };
}

const weekdayFormatter = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  timeZone,
});
const dayMonthFormatter = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  timeZone,
});

function formatDay(d: Date): string {
  return `${weekdayFormatter.format(d)} ${dayMonthFormatter.format(d)}`;
}

export function formatWeekRange(
  startIso?: string | null,
  endExclusiveIso?: string | null,
  fallback?: Date,
): string {
  let start: Date;
  let end: Date;

  if (startIso && endExclusiveIso) {
    start = new Date(startIso);
    end = new Date(new Date(endExclusiveIso).getTime() - 1);
  } else if (fallback) {
    const range = computeFallbackWeekRange(fallback);
    start = range.start;
    end = new Date(range.endExclusive.getTime() - 1);
  } else {
    start = new Date();
    end = new Date();
  }

  return `${formatDay(start)} – ${formatDay(end)}`;
}

export function formatMoney(centsOrAmount: number): string {
  return (
    "$" +
    Number(centsOrAmount).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function formatQuantity(n: number): string {
  return Number(n).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
