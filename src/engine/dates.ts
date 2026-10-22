/**
 * Historic date parsing and decimal-year conversion.
 *
 * Dates in the dataset are ISO-like strings with variable precision:
 * "0666", "1613-04" or "1798-07-17". The time engine works in decimal
 * years (e.g. 17 July 1798 ≈ 1798.54) so that months matter in the
 * 1798 chapter while centuries remain cheap to animate.
 */

export interface ParsedDate {
  year: number;
  month: number | null;
  day: number | null;
}

const DATE_PATTERN = /^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse "YYYY", "YYYY-MM" or "YYYY-MM-DD". Throws on malformed input. */
export function parseHistoricDate(value: string): ParsedDate {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Unrecognised date "${value}" — expected YYYY, YYYY-MM or YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month !== null && (month < 1 || month > 12)) {
    throw new Error(`Month out of range in "${value}".`);
  }
  if (day !== null && month !== null && (day < 1 || day > daysInMonth(year, month))) {
    throw new Error(`Day out of range in "${value}".`);
  }
  return { year, month, day };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const value = lengths[month - 1];
  if (value === undefined) throw new Error(`Invalid month ${month}`);
  return value;
}

function dayOfYear(year: number, month: number, day: number): number {
  let total = 0;
  for (let m = 1; m < month; m += 1) total += daysInMonth(year, m);
  return total + day;
}

/**
 * Convert a historic date string to a decimal year.
 *
 * @param value - Date string.
 * @param edge - "start" returns the beginning of the period (1 Jan for a
 *   year-only date); "end" returns its last moment, so a period
 *   [start(start_date), end(end_date)] is inclusive.
 */
export function toDecimalYear(value: string, edge: "start" | "end" = "start"): number {
  const { year, month, day } = parseHistoricDate(value);
  const yearDays = isLeapYear(year) ? 366 : 365;
  if (month === null) {
    return edge === "start" ? year : year + (yearDays - 1) / yearDays;
  }
  if (day === null) {
    const first = dayOfYear(year, month, 1) - 1;
    const last = first + daysInMonth(year, month) - 1;
    return year + (edge === "start" ? first : last) / yearDays;
  }
  return year + (dayOfYear(year, month, day) - 1) / yearDays;
}

/** Convert a decimal year back to a calendar date (day precision). */
export function fromDecimalYear(value: number): ParsedDate {
  const year = Math.floor(value);
  const yearDays = isLeapYear(year) ? 366 : 365;
  let remaining = Math.min(yearDays - 1, Math.max(0, Math.floor((value - year) * yearDays + 1e-9)));
  let month = 1;
  while (month <= 12) {
    const length = daysInMonth(year, month);
    if (remaining < length) break;
    remaining -= length;
    month += 1;
  }
  return { year, month: Math.min(month, 12), day: remaining + 1 };
}

/** Human-readable label for a decimal year at the requested precision. */
export function formatDecimalYear(value: number, precision: "year" | "month" | "day" = "year"): string {
  const { year, month, day } = fromDecimalYear(value);
  const yearLabel = formatYearNumber(year);
  if (precision === "year" || month === null) return yearLabel;
  const monthName = MONTHS[month - 1] ?? "";
  if (precision === "month" || day === null) return `${monthName} ${yearLabel}`;
  return `${day} ${monthName} ${yearLabel}`;
}

/** Years before 1000 are shown with "AD" so "666" is not misread. */
export function formatYearNumber(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  if (year < 1000) return `AD ${year}`;
  return String(year);
}

/** Format a dataset date string respecting its stated precision. */
export function formatHistoricDate(value: string, precision: string): string {
  const { year, month, day } = parseHistoricDate(value);
  const yearLabel = formatYearNumber(year);
  switch (precision) {
    case "century":
      return `${Math.floor(year / 100) + 1}th century`;
    case "decade":
      return `${Math.floor(year / 10) * 10}s`;
    case "year":
      return yearLabel;
    case "month":
      return month ? `${MONTHS[month - 1]} ${yearLabel}` : yearLabel;
    default:
      if (month && day) return `${day} ${MONTHS[month - 1]} ${yearLabel}`;
      if (month) return `${MONTHS[month - 1]} ${yearLabel}`;
      return yearLabel;
  }
}

/** Format an event's date span, e.g. "1682 – 1688" or "12 – 13 June 1798". */
export function formatEventSpan(start: string, end: string | null, precision: string): string {
  if (!end) return formatHistoricDate(start, precision);
  const a = parseHistoricDate(start);
  const b = parseHistoricDate(end);
  const startLabel = formatHistoricDate(start, a.day ? "day" : a.month ? "month" : "year");
  const endLabel = formatHistoricDate(end, b.day ? "day" : b.month ? "month" : "year");
  if (a.year === b.year && a.month && b.month && a.month === b.month && a.day && b.day) {
    return `${a.day} – ${endLabel}`;
  }
  return `${startLabel} – ${endLabel}`;
}
