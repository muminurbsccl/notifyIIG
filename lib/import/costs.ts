export type ImportCost = { monthlyCost: number | null; currency: string | null; rawDetails: string | null };

export function parseImportCost(input: unknown): ImportCost {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { monthlyCost: null, currency: null, rawDetails: null };
  const currencies = new Set<string>();
  if (/\bUSD\b/i.test(raw) || raw.includes("$")) currencies.add("USD");
  if (/\bSGD\b/i.test(raw)) currencies.add("SGD");
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const matches = raw.match(/[+-]?\(?\d[\d,.]*\)?/g) ?? [];
  if (matches.length !== 1 || currencies.size > 1) {
    return { monthlyCost: null, currency, rawDetails: raw };
  }
  const token = matches[0];
  const validAmount = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(token);
  if (!validAmount) return { monthlyCost: null, currency, rawDetails: raw };
  const amount = Number(token.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999_999.99) {
    return { monthlyCost: null, currency, rawDetails: raw };
  }
  return { monthlyCost: amount, currency, rawDetails: null };
}
