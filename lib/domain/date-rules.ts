export const DHAKA_TIME_ZONE = "Asia/Dhaka";

export type MilestoneDefinition = {
  key: string;
  label: string;
  monthsBefore?: number;
  daysBefore?: number;
  enabled?: boolean;
};

export type DueMilestone = {
  key: string;
  label: string;
  dueDate: string;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

function parseDateOnly(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    candidate.getUTCFullYear() !== parts.year ||
    candidate.getUTCMonth() !== parts.month - 1 ||
    candidate.getUTCDate() !== parts.day
  ) {
    throw new Error(`Invalid date-only value: ${value}`);
  }
  return parts;
}

export function isValidDateOnly(value: string): boolean {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

function formatDateOnly(parts: DateParts): string {
  return [parts.year, parts.month, parts.day]
    .map((part, index) => (index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0")))
    .join("-");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function subtractCalendarMonths(value: string, months: number): string {
  if (!Number.isInteger(months) || months < 0) {
    throw new Error("months must be a non-negative integer");
  }

  const source = parseDateOnly(value);
  const monthIndex = source.year * 12 + (source.month - 1) - months;
  const year = Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  const day = Math.min(source.day, daysInMonth(year, month));
  return formatDateOnly({ year, month, day });
}

export function subtractCalendarDays(value: string, days: number): string {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("days must be a non-negative integer");
  }

  const source = parseDateOnly(value);
  const date = new Date(Date.UTC(source.year, source.month - 1, source.day));
  date.setUTCDate(date.getUTCDate() - days);
  return formatDateOnly({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function calculateInitialReminder(expiryDate: string): string {
  return subtractCalendarMonths(expiryDate, 4);
}

export function getDhakaBusinessDate(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid date");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DHAKA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildMilestones(
  expiryDate: string,
  enabled: MilestoneDefinition[],
): DueMilestone[] {
  parseDateOnly(expiryDate);
  return enabled
    .filter((definition) => definition.enabled !== false)
    .map((definition) => {
      const hasMonths = definition.monthsBefore !== undefined;
      const hasDays = definition.daysBefore !== undefined;
      if (hasMonths === hasDays) {
        throw new Error(
          `Milestone ${definition.key} must define exactly one calendar or day offset`,
        );
      }

      const dueDate = hasMonths
        ? subtractCalendarMonths(expiryDate, definition.monthsBefore as number)
        : subtractCalendarDays(expiryDate, definition.daysBefore as number);
      return { key: definition.key, label: definition.label, dueDate };
    });
}
