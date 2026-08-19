import { describe, expect, it } from "vitest";
import { isNoticeOverdue, noticeDate, type NoticeDateCircuit } from "@/lib/domain/notice-date";

describe("noticeDate", () => {
  it("uses the stored procedure start date when present", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2027-02-18",
      renewal_procedure_start_date: "2026-10-21",
    };
    expect(noticeDate(circuit)).toBe("2026-10-21");
  });

  it("falls back to expiry minus 3 calendar months when stored date is null", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2027-02-18",
      renewal_procedure_start_date: null,
    };
    expect(noticeDate(circuit)).toBe("2026-11-18");
  });

  it("clamps to the last day of short months", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2026-05-31",
      renewal_procedure_start_date: null,
    };
    expect(noticeDate(circuit)).toBe("2026-02-28");
  });

  it("returns null when there is no expiry date", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: null,
      renewal_procedure_start_date: null,
    };
    expect(noticeDate(circuit)).toBeNull();
  });
});

describe("isNoticeOverdue", () => {
  it("flags when the notice date passed and expiry is still ahead", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2026-08-19",
      renewal_procedure_start_date: "2026-05-01",
    };
    expect(isNoticeOverdue(circuit, "2026-08-19")).toBe(true);
  });

  it("does not flag when the notice date is today (strictly before)", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2026-11-19",
      renewal_procedure_start_date: "2026-08-19",
    };
    expect(isNoticeOverdue(circuit, "2026-08-19")).toBe(false);
  });

  it("does not flag when the circuit has already expired", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2026-08-18",
      renewal_procedure_start_date: "2026-05-01",
    };
    expect(isNoticeOverdue(circuit, "2026-08-19")).toBe(false);
  });

  it("does not flag a circuit without expiry", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: null,
      renewal_procedure_start_date: null,
    };
    expect(isNoticeOverdue(circuit, "2026-08-19")).toBe(false);
  });
});
