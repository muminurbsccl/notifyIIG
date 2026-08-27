import { escapeHtml } from "@/lib/domain/templates";

const APP_URL = "https://notifyiig.vercel.app";
const LOGO_URL = APP_URL + "/brand/bscplc-logo.jpg";

type Urgency = "info" | "warning" | "critical";

function detectUrgency(label: string): Urgency {
  const lower = label.toLowerCase();
  if (lower.includes("expiry-day") || lower.includes("t-0") || lower.includes("expired")) return "critical";
  if (lower.includes("thirty") || lower.includes("30-day") || lower.includes("t-30")) return "warning";
  return "info";
}

function urgencyMeta(urgency: Urgency) {
  if (urgency === "critical") {
    return {
      badge: "CRITICAL - ACTION REQUIRED TODAY",
      badgeBg: "#b51d22",
      accent: "#b51d22",
      accentBg: "#fdebed",
      intro: "This circuit has reached its expiry date. Immediate renewal action is required to prevent service disruption.",
      icon: "&#9940;",
    };
  }
  if (urgency === "warning") {
    return {
      badge: "URGENT - 30 DAYS REMAINING",
      badgeBg: "#866900",
      accent: "#866900",
      accentBg: "#fff7d6",
      intro: "This circuit will expire in 30 days. Please complete renewal procedures urgently to ensure uninterrupted service.",
      icon: "&#9888;",
    };
  }
  return {
    badge: "REMINDER - 4 MONTHS BEFORE EXPIRY",
    badgeBg: "#123a63",
    accent: "#205fa8",
    accentBg: "#e8f1fb",
    intro: "This is an early reminder to initiate renewal planning. Starting now ensures sufficient time for approvals and vendor coordination.",
    icon: "&#128276;",
  };
}

export function buildExpiryEmail(input: {
  circuitId: string;
  expiryDate: string;
  milestoneLabel: string;
}) {
  const circuitId = escapeHtml(input.circuitId);
  const expiryDate = escapeHtml(input.expiryDate);
  const milestone = escapeHtml(input.milestoneLabel);
  const urgency = detectUrgency(input.milestoneLabel);
  const meta = urgencyMeta(urgency);

  const subject = "BSCPLC - Circuit " + input.circuitId + " expires " + input.expiryDate + " [" + meta.badge.split("-")[0].trim() + "]";

  let actionHtml: string;
  let actionText: string;
  let heroTitle: string;
  if (urgency === "critical") {
    actionHtml = "Renewal is overdue. Please contact the provider and update the renewal status in the dashboard immediately. If renewed, record the new expiry date to stop further alerts.";
    actionText = "Renewal is overdue - contact the provider and update the renewal status immediately.";
    heroTitle = "alert";
  } else if (urgency === "warning") {
    actionHtml = "Complete vendor follow-up, payment and documentation within the next 30 days. Update the circuit record once the renewal is confirmed.";
    actionText = "Complete renewal within 30 days and update the circuit record.";
    heroTitle = "reminder";
  } else {
    actionHtml = "Begin internal approvals and vendor engagement. You will receive further reminders at 30 days and on the expiry date if no renewal is recorded.";
    actionText = "Begin renewal planning now; further reminders follow at 30 days and on expiry.";
    heroTitle = "notification";
  }

  const escSubject = escapeHtml(subject);
  const escIntro = escapeHtml(meta.intro);
  const escActionHtml = escapeHtml(actionHtml);

  const bodyHtml =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
    escSubject +
    '</title></head><body style="margin:0;padding:0;background:#f3f5f7;font-family:Arial,Helvetica,sans-serif;color:#18324a;-webkit-text-size-adjust:100%">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:28px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #d9e2ea;border-radius:14px;overflow:hidden;box-shadow:0 12px 32px rgba(18,58,99,0.09)">' +
    '<tr><td style="background:#0b3b6e;padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="padding:22px 28px 18px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:middle;padding-right:14px"><img src="' +
    LOGO_URL +
    '" alt="BSCPLC" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:8px;background:#ffffff;object-fit:cover;border:1px solid rgba(255,255,255,0.2)"></td>' +
    '<td style="vertical-align:middle"><div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:800;color:#c7d9eb;line-height:1">BSCPLC IPT NotifySystem</div><div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.7);margin-top:3px">Bangladesh Submarine Cables PLC</div></td>' +
    '</tr></table></td>' +
    '<td style="padding:22px 28px 18px;text-align:right;vertical-align:middle"><div style="display:inline-block;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.18);color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;padding:7px 10px;border-radius:999px;white-space:nowrap">' +
    escapeHtml(meta.badge) +
    '</div></td></tr></table><div style="height:4px;background:' +
    meta.accent +
    '"></div></td></tr>' +
    '<tr><td style="padding:28px 28px 0"><h1 style="margin:0;font-size:22px;line-height:1.25;color:#123a63;font-weight:800">' +
    meta.icon +
    ' Circuit expiry ' +
    heroTitle +
    '</h1><p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:#607285">' +
    escIntro +
    '</p></td></tr>' +
    '<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d9e2ea;border-radius:10px;overflow:hidden">' +
    '<tr><td style="background:' +
    meta.accentBg +
    ';padding:14px 18px;border-bottom:1px solid #d9e2ea"><div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:800;color:' +
    meta.accent +
    '">SERVICE CIRCUIT DETAILS</div></td></tr>' +
    '<tr><td style="padding:0 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' +
    '<tr><td style="padding:16px 0;border-bottom:1px solid #e7edf3;width:36px;vertical-align:middle"><div style="width:32px;height:32px;border-radius:8px;background:#e8f1fb;display:inline-block;text-align:center;line-height:32px;font-size:14px">&#128279;</div></td><td style="padding:16px 12px;border-bottom:1px solid #e7edf3;color:#5d6b7a;font-size:13px">Circuit ID</td><td style="padding:16px 0;border-bottom:1px solid #e7edf3;text-align:right;font-weight:800;color:#123a63;font-size:14px;word-break:break-all">' +
    circuitId +
    '</td></tr>' +
    '<tr><td style="padding:16px 0;border-bottom:1px solid #e7edf3;vertical-align:middle"><div style="width:32px;height:32px;border-radius:8px;background:' +
    meta.accentBg +
    ';display:inline-block;text-align:center;line-height:32px;font-size:14px">&#128197;</div></td><td style="padding:16px 12px;border-bottom:1px solid #e7edf3;color:#5d6b7a;font-size:13px">Expiry date</td><td style="padding:16px 0;border-bottom:1px solid #e7edf3;text-align:right;font-weight:800;color:' +
    meta.accent +
    ';font-size:14px">' +
    expiryDate +
    '</td></tr>' +
    '<tr><td style="padding:16px 0;vertical-align:middle"><div style="width:32px;height:32px;border-radius:8px;background:#f3f5f7;display:inline-block;text-align:center;line-height:32px;font-size:14px">&#127991;</div></td><td style="padding:16px 12px;color:#5d6b7a;font-size:13px">Notice</td><td style="padding:16px 0;text-align:right;font-weight:700;color:#18324a;font-size:13px">' +
    milestone +
    '</td></tr>' +
    '</table></td></tr></table></td></tr>' +
    '<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fb;border:1px solid #e7edf3;border-radius:10px"><tr><td style="padding:16px 18px"><div style="font-size:13px;font-weight:800;color:#123a63;margin-bottom:6px">What you should do</div><div style="font-size:13.5px;line-height:1.6;color:#34495e;margin:0">' +
    escActionHtml +
    '</div></td></tr></table></td></tr>' +
    '<tr><td style="padding:22px 28px 0;text-align:center"><a href="' +
    APP_URL +
    '/circuits" style="display:inline-block;background:#205fa8;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 22px;border-radius:9px">View in Dashboard &rarr;</a><div style="font-size:12px;color:#607285;margin-top:10px">Or open <a href="' +
    APP_URL +
    '/circuits" style="color:#205fa8;text-decoration:underline">notifyiig.vercel.app/circuits</a> and search for <strong>' +
    circuitId +
    '</strong></div></td></tr>' +
    '<tr><td style="padding:22px 28px 0"><p style="margin:0;font-size:13.5px;line-height:1.7;color:#34495e">Dear Operations Team,<br>This is an automated notification from the BSCPLC IIG Upstream Notification System. Please treat this as an official reminder and take the required action before the stated expiry date to avoid any interruption of international IP transit services.</p><p style="margin:14px 0 0;font-size:13.5px;line-height:1.7;color:#34495e">Kind regards,<br><strong style="color:#123a63">BSCPLC - IIG Operations</strong><br><span style="color:#607285">International Internet Gateway &bull; Bangladesh Submarine Cables PLC</span></p></td></tr>' +
    '<tr><td style="padding:26px 28px;background:#f7f9fb;border-top:1px solid #e7edf3"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle"><img src="' +
    LOGO_URL +
    '" alt="" width="28" height="28" style="display:block;width:28px;height:28px;border-radius:6px;background:#ffffff;border:1px solid #d9e2ea;opacity:0.95"></td><td style="padding-left:10px;vertical-align:middle"><div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;font-weight:800;color:#607285">BSCPLC IPT NOTIFYSYSTEM</div><div style="font-size:11px;color:#8a9aad;line-height:1.4">Automated notification &bull; Do not reply directly &bull; Manage preferences in Settings &bull; <a href="' +
    APP_URL +
    '" style="color:#205fa8;text-decoration:underline">notifyiig.vercel.app</a></div></td></tr></table></td></tr>' +
    '</table><div style="max-width:640px;margin:14px auto 0;text-align:center;font-size:11px;color:#8a9aad;line-height:1.5">You received this because you are subscribed to circuit expiry notifications for your provider or as BSCPLC support. Update recipients in the provider notification settings.</div></td></tr></table></body></html>';

  const bodyText =
    "BSCPLC IPT NotifySystem - " +
    meta.badge +
    "\n\n" +
    meta.intro +
    "\n\nCircuit: " +
    input.circuitId +
    "\nExpiry date: " +
    input.expiryDate +
    "\nNotice: " +
    input.milestoneLabel +
    "\n\nWhat to do:\n" +
    actionText +
    "\n\nView in dashboard: " +
    APP_URL +
    "/circuits (search: " +
    input.circuitId +
    ")\n\nKind regards,\nBSCPLC - IIG Operations\nInternational Internet Gateway - Bangladesh Submarine Cables PLC\n\nThis is an automated notification from BSCPLC IPT NotifySystem. Do not reply unless a reply address is configured. Manage preferences in Settings at " +
    APP_URL +
    ".";

  return {
    subject: subject,
    bodyHtml: bodyHtml,
    bodyText: bodyText,
  };
}
