import type { ReactElement } from "react";
import { isNoticeOverdue, noticeDate, type NoticeDateCircuit } from "@/lib/domain/notice-date";

type NoticeDateCellProps = {
  circuit: NoticeDateCircuit;
  businessDate: string;
};

export function NoticeDateCell({ circuit, businessDate }: NoticeDateCellProps): ReactElement {
  const date = noticeDate(circuit);
  if (date === null) {
    return <td>—</td>;
  }
  const overdue = isNoticeOverdue(circuit, businessDate);
  return (
    <td>
      <span className={overdue ? "notice-date-overdue" : undefined}>{date}</span>
      {overdue && <span className="badge badge-gold">Overdue</span>}
    </td>
  );
}
