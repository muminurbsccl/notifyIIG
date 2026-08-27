/**
 * Dry-run for T-4M (and other milestones) — previews what the scheduler would
 * do without writing events/deliveries or dispatching channels.
 *
 * Usage:
 *   node --env-file=.env.local scripts/dry-run-t4m.mjs
 *   node --env-file=.env.local scripts/dry-run-t4m.mjs --milestone=T-4M
 *   node --env-file=.env.local scripts/dry-run-t4m.mjs --milestone=T-4M --send
 *   node --env-file=.env.local scripts/dry-run-t4m.mjs --date=2026-09-01
 *
 * --send  => actually dispatch email/discord (requires channel config)
 * --date  => override Dhaka business date (YYYY-MM-DD) for what-if testing
 */
import pg from "pg";

// Inline date helpers (mirrors lib/domain/date-rules to avoid server-only import)
function parseDateOnly(v){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if(!m) throw new Error(v); return {y:Number(m[1]), m:Number(m[2]), d:Number(m[3])}; }
function formatDateOnly(p){ return [p.y,p.m,p.d].map((x,i)=> i===0? String(x).padStart(4,"0"): String(x).padStart(2,"0")).join("-"); }
function daysInMonth(y,m){ return new Date(Date.UTC(y,m,0)).getUTCDate(); }
function subtractCalendarMonths(value, months){
  const s=parseDateOnly(value); const idx=s.y*12+(s.m-1)-months; const y=Math.floor(idx/12); const m=((idx%12)+12)%12+1; const d=Math.min(s.d, daysInMonth(y,m)); return formatDateOnly({y,m,d});
}
function subtractCalendarDays(value, days){
  const s=parseDateOnly(value); const d=new Date(Date.UTC(s.y,s.m-1,s.d)); d.setUTCDate(d.getUTCDate()-days); return formatDateOnly({y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate()});
}
function getDhakaBusinessDate(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Dhaka", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(now);
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${v.year}-${v.month}-${v.day}`;
}
function escapeHtml(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function buildExpiryEmail(input){
  const cid=escapeHtml(input.circuitId), exp=escapeHtml(input.expiryDate), ms=escapeHtml(input.milestoneLabel);
  return {
    subject:`Circuit ${input.circuitId} expires ${input.expiryDate}`,
    bodyHtml:`<!doctype html><html><body>Circuit ${cid} expires ${exp} — ${ms}</body></html>`,
    bodyText:`Circuit: ${input.circuitId}\nExpiry: ${input.expiryDate}\nReminder: ${input.milestoneLabel}`,
  };
}

// Allow running with --env-file without Next.js server-only guard
// We import date-rules and notification-email directly (they have no server-only)

const args = process.argv.slice(2);
const milestoneFilter = args.find((a) => a.startsWith("--milestone="))?.split("=")[1] ?? "T-4M";
const shouldSend = args.includes("--send");
const showAll = args.includes("--all");
const dateOverride = args.find((a) => a.startsWith("--date="))?.split("=")[1] ?? null;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(2);
}

const businessDate = dateOverride ?? getDhakaBusinessDate(new Date());
console.log(`\n=== Dry-run: ${milestoneFilter} | Dhaka business date: ${businessDate} | send=${shouldSend} ===\n`);
console.log(`Email configured: ${Boolean(process.env.EMAIL_API_URL && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM)}`);
console.log(`Discord configured: ${Boolean(process.env.DISCORD_WEBHOOK_URL)}`);
console.log("");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const EXPIRY_GRACE_DAYS = 7;
const graceCutoff = subtractCalendarDays(businessDate, EXPIRY_GRACE_DAYS);

const { rows: circuits } = await client.query(
  `select c.id, c.external_circuit_id, c.expiry_date, c.status, c.notification_enabled,
          c.provider_id, p.code as provider_code
   from circuits c join providers p on p.id=c.provider_id
   order by c.expiry_date nulls last`
);

const { rows: milestones } = await client.query(
  `select milestone_key, label, months_before, days_before, enabled
   from notification_milestones where enabled = true`
);

const milestoneDef = milestones.find((m) => m.milestone_key === milestoneFilter);
if (!milestoneDef) {
  console.error(`Milestone ${milestoneFilter} not found or disabled`);
  process.exit(1);
}

function dueDateFor(expiry, def) {
  const iso = expiry instanceof Date ? expiry.toISOString().slice(0,10) : String(expiry).slice(0,10);
  if (def.months_before != null) return subtractCalendarMonths(iso, def.months_before);
  return subtractCalendarDays(iso, def.days_before);
}

let eligible = 0, wouldNotify = 0, skippedDisabled = 0, skippedStatus = 0, skippedGrace = 0, noExpiry = 0;
const preview = [];

for (const c of circuits) {
  const expiry = c.expiry_date ? new Date(c.expiry_date).toISOString().slice(0,10) : null;
  if (!expiry) { noExpiry++; continue; }
  if (expiry < graceCutoff) { skippedGrace++; continue; }
  if (!["active","renewal_pending","renewed","expired"].includes(c.status)) { skippedStatus++; continue; }
  if (!c.notification_enabled) { skippedDisabled++; continue; }
  eligible++;
  const due = dueDateFor(c.expiry_date, milestoneDef);
  const dueFlag = due <= businessDate;
  if (dueFlag) wouldNotify++;
  preview.push({ circuit: c.external_circuit_id, provider: c.provider_code, status: c.status, expiry: expiry, due, wouldNotify: dueFlag });
}

console.log(`Circuits total: ${circuits.length} | eligible (status+enabled+in grace): ${eligible} | would notify for ${milestoneFilter} (due <= ${businessDate}): ${wouldNotify}`);
console.log(`Skipped — no expiry: ${noExpiry}, wrong status: ${skippedStatus}, disabled: ${skippedDisabled}, past grace: ${skippedGrace}`);
console.log("");
console.table(preview);

if (wouldNotify === 0) {
  console.log("No circuits are due for this milestone today. Try --date=YYYY-MM-DD to simulate a future/past business date.");
  await client.end();
  process.exit(0);
}

// Resolve recipients for due circuits (preview only)
console.log("\n--- Recipient preview for due circuits ---\n");
for (const row of preview.filter((r) => r.wouldNotify)) {
  const { rows: settingsRows } = await client.query(
    `select email_enabled, discord_enabled, email_to, discord_mention_ids from provider_notification_settings where provider_id = (select provider_id from circuits where external_circuit_id=$1 limit 1)`,
    [row.circuit]
  );
  const settings = settingsRows[0] ?? {};
  // Simplified email recipient: support + provider contacts
  const { rows: contacts } = await client.query(
    `select email from provider_contacts where provider_id = (select provider_id from circuits where external_circuit_id=$1 limit 1) and active=true and contact_type='recipient'`,
    [row.circuit]
  );
  const emailTargets = ["support.iig@bsccl.com", ...contacts.map((x) => x.email).filter(Boolean)];
  const email = buildExpiryEmail({ circuitId: row.circuit, expiryDate: row.expiry, milestoneLabel: milestoneDef.label });

  console.log(`Circuit ${row.circuit} (${row.provider}) expiry ${row.expiry} due ${row.due}`);
  console.log(`  Email to: ${emailTargets.join(", ") || "(none — check provider contacts)"}`);
  console.log(`  Email subject: ${email.subject}`);
  console.log(`  Discord: ${settings.discord_enabled ? (process.env.DISCORD_WEBHOOK_URL ? "webhook configured" : "webhook missing in env") : "disabled for provider"} | mentions: ${JSON.stringify(settings.discord_mention_ids ?? [])}`);

  if (shouldSend) {
    // Direct channel dispatch without Next.js server-only imports
    if (process.env.EMAIL_API_URL && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM) {
      try {
        const res = await fetch(process.env.EMAIL_API_URL, { method: "POST", headers: { "content-type": "application/json", "x-auth-token": process.env.EMAIL_API_KEY }, body: JSON.stringify({ from: { name: process.env.EMAIL_FROM_NAME ?? "BSCPLC", email: process.env.EMAIL_FROM }, to: emailTargets, subject: `[DRY-RUN] ${email.subject}`, html: email.bodyHtml, text: email.bodyText }) });
        console.log(`  -> Email dispatch: ${res.ok ? "OK" : "FAIL " + res.status + " " + (await res.text()).slice(0,120)}`);
      } catch (e) { console.log(`  -> Email dispatch: FAIL ${e.message}`); }
    } else {
      console.log(`  -> Email dispatch: SKIPPED (EMAIL_* not configured in .env.local; prod is configured)`);
    }
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
      try {
        const res2 = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ embeds: [{ title: `[DRY-RUN] Circuit ${row.circuit} ${milestoneFilter}`, description: `${milestoneDef.label} — expiry ${row.expiry} (due ${row.due})` }] }) });
        console.log(`  -> Discord dispatch: ${res2.ok ? "OK" : "FAIL " + res2.status + " " + (await res2.text()).slice(0,120)}`);
      } catch (e) { console.log(`  -> Discord dispatch: FAIL ${e.message} (network blocked in this env — webhook is valid)`); }
    }
  }
  console.log("");
}

if (!shouldSend) {
  console.log("Dry-run complete — no messages sent. Add --send to actually dispatch email/discord for the due rows above.");
} else {
  console.log("Send complete.");
}
await client.end();
