import { internetExchangeAdapter } from "./internet-exchange";
import { singaporeEquinixAdapter } from "./singapore-equinix";
import type { WorkbookSheetAdapter } from "./types";
import { upstreamBackhaulAdapter } from "./upstream-backhaul";
import { upstreamIptAdapter } from "./upstream-ipt";

export const APPROVED_WORKBOOK_SHEET_NAMES = Object.freeze([
  upstreamIptAdapter.sheetName,
  upstreamBackhaulAdapter.sheetName,
  internetExchangeAdapter.sheetName,
  singaporeEquinixAdapter.sheetName,
] as const);

const workbookSheetAdapters = new Map<string, WorkbookSheetAdapter>([
  [upstreamIptAdapter.sheetName, upstreamIptAdapter],
  [upstreamBackhaulAdapter.sheetName, upstreamBackhaulAdapter],
  [internetExchangeAdapter.sheetName, internetExchangeAdapter],
  [singaporeEquinixAdapter.sheetName, singaporeEquinixAdapter],
]);

export function getWorkbookSheetAdapter(sheetName: string): WorkbookSheetAdapter | undefined {
  return workbookSheetAdapters.get(sheetName);
}

export { internetExchangeAdapter, singaporeEquinixAdapter, upstreamBackhaulAdapter, upstreamIptAdapter };
