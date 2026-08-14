const months: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export type ParsedWorkbookDate = { value: string } | { value: null; error: "INVALID_DATE" };

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseWorkbookDate(input: unknown): ParsedWorkbookDate {
  const text = typeof input === "string" ? input.trim() : "";
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (named && months[named[2].toLowerCase()]) {
    day = Number(named[1]); month = months[named[2].toLowerCase()];
    const parsedYear = Number(named[3]);
    year = named[3].length === 2 ? 2000 + parsedYear : parsedYear;
  } else {
    return { value: null, error: "INVALID_DATE" };
  }
  if (!validDate(year, month, day)) return { value: null, error: "INVALID_DATE" };
  return { value: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}` };
}
