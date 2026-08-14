export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r\n?/g, "\n").trim();
}

export function headerKey(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((value) => cellText(value) === "");
}

export function splitMultiline(value: unknown): string[] {
  return cellText(value).split("\n").map((part) => part.trim()).filter(Boolean);
}
