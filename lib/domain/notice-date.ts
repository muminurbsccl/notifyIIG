import { subtractCalendarMonths } from "@/lib/domain/date-rules";

export type NoticeDateCircuit = {
  expiry_date: string | null;
  renewal_procedure_start_date: string | null;
};

export function noticeDate(circuit: NoticeDateCircuit): string | null {
  if (circuit.renewal_procedure_start_date !== null) {
    return circuit.renewal_procedure_start_date;
  }
  if (circuit.expiry_date === null) {
    return null;
  }
  return subtractCalendarMonths(circuit.expiry_date, 3);
}

export function isNoticeOverdue(circuit: NoticeDateCircuit, businessDate: string): boolean {
  const notice = noticeDate(circuit);
  if (notice === null || circuit.expiry_date === null) {
    return false;
  }
  return notice < businessDate && circuit.expiry_date >= businessDate;
}
