import { escapeHtml } from "@/lib/domain/templates";

export function buildExpiryEmail(input: {
  circuitId: string;
  expiryDate: string;
  milestoneLabel: string;
}) {
  const circuitId = escapeHtml(input.circuitId);
  const expiryDate = escapeHtml(input.expiryDate);
  const milestone = escapeHtml(input.milestoneLabel);
  return {
    subject: `Circuit ${input.circuitId} expires ${input.expiryDate}`,
    bodyHtml: `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#182230"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #dbe3ec;border-radius:12px;overflow:hidden"><tr><td style="background:#0b3b6e;padding:24px 32px;color:#fff"><div style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold">BSCPLC IPT NotifySystem</div><div style="font-size:24px;font-weight:bold;margin-top:10px">Circuit expiry reminder</div></td></tr><tr><td style="padding:32px"><p style="font-size:16px;line-height:1.6;margin:0 0 22px">Action is required for the following service circuit.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px"><tr><td style="padding:12px 0;border-bottom:1px solid #e7edf3;color:#5d6b7a">Circuit</td><td style="padding:12px 0;border-bottom:1px solid #e7edf3;text-align:right;font-weight:bold">${circuitId}</td></tr><tr><td style="padding:12px 0;border-bottom:1px solid #e7edf3;color:#5d6b7a">Expiry date</td><td style="padding:12px 0;border-bottom:1px solid #e7edf3;text-align:right;font-weight:bold;color:#a33b22">${expiryDate}</td></tr><tr><td style="padding:12px 0;color:#5d6b7a">Reminder</td><td style="padding:12px 0;text-align:right;font-weight:bold">${milestone}</td></tr></table><p style="font-size:15px;line-height:1.6;margin:0">Please review the renewal status and take the required action before the expiry date.</p></td></tr><tr><td style="padding:20px 32px;background:#f7f9fb;color:#697786;font-size:12px;line-height:1.5">This is an automated notification from BSCPLC IPT NotifySystem. Please do not reply unless a reply address is configured.</td></tr></table></td></tr></table></body></html>`,
    bodyText: `BSCPLC IPT NotifySystem\n\nCircuit expiry reminder\n\nCircuit: ${input.circuitId}\nExpiry date: ${input.expiryDate}\nReminder: ${input.milestoneLabel}\n\nPlease review the renewal status and take the required action before the expiry date.`,
  };
}
