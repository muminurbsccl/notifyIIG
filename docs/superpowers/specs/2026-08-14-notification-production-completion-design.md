# Notification and Production Completion Design

**Date:** 2026-08-14
**Status:** Approved design, pending written-spec review

## Objective

Apply workbook-specific reminder dates safely, guarantee delivery to BSCPLC IIG
support, prevent a historical notification flood, and verify the complete
production path from authentication and import through idempotent email
delivery.

## Reminder scheduling

- When `renewal_procedure_start_date` exists, it replaces the calculated due
  date of the first four-calendar-month milestone for that circuit and expiry
  version.
- Without an override, the existing calendar four-month rule remains in force.
- Later configured milestones continue to derive from expiry without change.
- On first notification activation, if multiple milestones are already due, the
  scheduler creates one consolidated catch-up event for the latest operational
  state and marks earlier due milestones satisfied.
- The catch-up and satisfied markers are scoped to circuit and expiry version.
  A scheduler retry or later run cannot reproduce them; a verified new expiry
  version receives a new schedule.

## Recipient routing

`support.iig@bsccl.com` is a mandatory recipient for every email notification.
It is included whether or not provider contacts exist and cannot be suppressed
by a provider-level email toggle. Active configured provider contacts and
explicit `To` recipients are additional recipients when provider email is
enabled.

Recipient addresses are trimmed, normalized case-insensitively, and deduplicated
before delivery creation. Each resulting target retains its own encrypted
delivery record, target hash, idempotency key, attempt count, retry state, and
external message ID. A failure for one target does not suppress another.

WhatsApp and Discord remain disabled until their external approvals and
credentials exist. They are explicitly excluded from the production-completion
gate.

## Event and delivery data flow

1. The scheduler selects verified, enabled, non-expired operational records.
2. It builds milestones using the procedure-date override and standard later
   milestones.
3. For a newly activated record with overdue milestones, it atomically records
   one catch-up event and satisfaction state for the older milestones.
4. Recipient resolution always adds the mandatory support address, then adds
   enabled configured contacts and deduplicates the result.
5. Independent deliveries are queued and claimed through the existing
   idempotent retry flow.
6. The email adapter sends through the configured Cloudflare relay and records
   accepted IDs or categorized failure state.

## Error handling and security

- Import commit and notification delivery are separate transactions. An email
  outage never rolls back trusted imported records.
- Transient relay failures remain retryable; permanent validation or
  configuration failures are recorded without leaking secrets.
- Missing optional provider contacts no longer produce a zero-recipient event
  because mandatory support routing remains available.
- Recipient values stay encrypted at rest and appear only in masked form in
  ordinary operational responses and logs.
- Catch-up creation uses database uniqueness/idempotency boundaries so
  concurrent cron runs cannot produce duplicates.

## Production release sequence

1. Apply and verify the additive database migration.
2. Deploy the public login/authentication work and importer through the existing
   GitHub-to-Vercel path.
3. Configure the Supabase production Site URL and PKCE callback allow-list.
4. Verify production password and magic-link authentication.
5. Upload the private workbook to the authenticated preview endpoint and verify
   the structural counts and warnings from the import specification.
6. Obtain a separate operator confirmation, then commit the import and verify
   lifecycle state, metadata, lineage, verification, and audit records.
7. Obtain a separate operator confirmation for live email, then run the
   scheduler. Confirm one catch-up email per eligible record reaches
   `support.iig@bsccl.com` and configured contacts without a historical
   milestone flood.
8. Run the scheduler again and confirm no duplicate events or deliveries.
9. Verify unauthenticated protected-route redirects, cron authentication,
   authenticated cron execution, audit visibility, and retry state.
10. Run and retain mobile and desktop production Lighthouse reports according
    to the public-login specification.

## Testing and acceptance

- Unit-test first-date overrides, calendar fallback, later milestones,
  consolidated catch-up selection, satisfaction markers, expiry-version reset,
  and concurrent/idempotent scheduler behavior.
- Test mandatory support inclusion with no contacts, with contacts, with the
  support address already configured, and with provider email disabled.
- Test case-insensitive deduplication, independent deliveries, encryption,
  transient retries, permanent failures, and relay response handling.
- Run typecheck, lint, full tests, production build, migration verification, and
  focused production route checks.
- Completion requires successful password and magic-link authentication,
  reviewed import and commit, one successful controlled live email run, a
  duplicate-free second scheduler run, and the public-page Lighthouse gate.

## Dependencies, risks, and non-goals

This work follows the public-authentication and workbook-import specifications.
Hosted Supabase Auth settings and live email delivery require operator-visible
external services. Vercel environment changes require a redeployment.

The historical `PRD.docx` object remains retrievable from earlier public Git
history. Purging it is excluded because that requires a destructive history
rewrite and explicit force-push authorization. WhatsApp, Discord, and hosting
plan approval are also outside this completion gate.
