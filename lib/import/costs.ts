export type ImportCost = { monthlyCost: number | null; currency: string | null; rawDetails: string | null };

export function parseImportCost(input: unknown): ImportCost {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { monthlyCost: null, currency: null, rawDetails: null };
  const currency = /\bSGD\b/i.test(raw) ? "SGD" : (/\bUSD\b/i.test(raw) || raw.includes("$") ? "USD" : null);
  const matches = raw.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (matches.length !== 1) return { monthlyCost: null, currency, rawDetails: raw };
  const amount = Number(matches[0].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999_999.99) {
    return { monthlyCost: null, currency, rawDetails: raw };
  }
  return { monthlyCost: Math.round(amount * 100) / 100, currency, rawDetails: null };
}
