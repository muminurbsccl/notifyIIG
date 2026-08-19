import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoticeDateCell } from "@/components/notice-date-cell";
import type { NoticeDateCircuit } from "@/lib/domain/notice-date";

describe("NoticeDateCell", () => {
  it("renders the stored procedure date with an Overdue badge when overdue", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2026-08-19",
      renewal_procedure_start_date: "2026-05-01",
    };
    const html = renderToString(createElement(NoticeDateCell, { circuit, businessDate: "2026-08-19" }));
    expect(html).toContain("2026-05-01");
    expect(html).toContain("badge-gold");
    expect(html).toContain("Overdue");
    expect(html).toContain("notice-date-overdue");
  });

  it("renders the fallback date without a badge when not overdue", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2027-02-18",
      renewal_procedure_start_date: null,
    };
    const html = renderToString(createElement(NoticeDateCell, { circuit, businessDate: "2026-08-19" }));
    expect(html).toContain("2026-11-18");
    expect(html).not.toContain("badge-gold");
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain("notice-date-overdue");
  });

  it("renders an em dash when there is no notice date", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: null,
      renewal_procedure_start_date: null,
    };
    const html = renderToString(createElement(NoticeDateCell, { circuit, businessDate: "2026-08-19" }));
    expect(html).toContain("—");
    expect(html).not.toContain("notice-date-overdue");
  });
});
