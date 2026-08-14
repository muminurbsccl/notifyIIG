import { internetExchangeAdapter } from "./internet-exchange";
import { singaporeEquinixAdapter } from "./singapore-equinix";
import type { WorkbookSheetAdapter } from "./types";
import { upstreamBackhaulAdapter } from "./upstream-backhaul";
import { upstreamIptAdapter } from "./upstream-ipt";

export const WORKBOOK_SHEET_ADAPTERS = new Map<string, WorkbookSheetAdapter>([
  [upstreamIptAdapter.sheetName, upstreamIptAdapter],
  [upstreamBackhaulAdapter.sheetName, upstreamBackhaulAdapter],
  [internetExchangeAdapter.sheetName, internetExchangeAdapter],
  [singaporeEquinixAdapter.sheetName, singaporeEquinixAdapter],
]);

export { internetExchangeAdapter, singaporeEquinixAdapter, upstreamBackhaulAdapter, upstreamIptAdapter };
