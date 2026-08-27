import { subtractCalendarMonths, toDateOnly } from "@/lib/domain/date-rules";

export type NoticeDateCircuit = {
  expiry_date: string | null;
  renewal_procedure_start_date: string | null;
};

export function noticeDate(circuit: NoticeDateCircuit): string | null {
  if (circuit.renewal_procedure_start_date !== null) {
    return toDateOnly(circuit.renewal_procedure_start_date);
  }
  if (circuit.expiry_date === null) {
    return null;
  }
  return subtractCalendarMonths(toDateOnly(circuit.expiry_date), 3);
}

export function isNoticeOverdue(circuit: NoticeDateCircuit, businessDate: string): boolean {
  const notice = noticeDate(circuit);
  if (notice === null || circuit.expiry_date === null) {
    return false;
  }
  return notice < businessDate && toDateOnly(circuit.expiry_date) >= businessDate;
}
