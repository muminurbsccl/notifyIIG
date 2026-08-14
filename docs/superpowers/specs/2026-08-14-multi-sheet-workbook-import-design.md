# Multi-Sheet Workbook Import Design

**Date:** 2026-08-14
**Status:** Approved design, pending written-spec review

## Objective

Import the operator-supplied 2026 upstream service workbook through a
deterministic, auditable, multi-sheet workflow without committing the private
source or its real records to Git. Complete records become trusted operational
records; incomplete records remain visible, non-notifying drafts.

## Privacy boundary

- The workbook remains outside the repository and is never copied into project
  directories, fixtures, build artifacts, or commits.
- Automated tests use synthetic values that reproduce only the workbook's
  structural patterns.
- Preview responses contain normalized fields and source sheet/row lineage, not
  complete raw rows.
- The private workbook is uploaded only through the authenticated production
  preview endpoint when the operator approves the import step.

## Adapter architecture

The parser dispatches recognized worksheets to focused adapters, merges their
output into one normalized preview model, and recognizes only these operational
worksheets:

- `Upstream (IPT)`
- `Upstream (Backhaul)`
- `Internet Exchange`
- `Singapore Equinix`

The helper worksheet `Sheet1` is deliberately ignored and reported as an
informational preview issue. Unknown non-empty worksheets are warnings that
require operator review; they are not parsed by guessing.

Each adapter has one purpose: identify its headers and sections, validate its
rows, and return normalized providers, services, alternate identifiers,
metadata, and issues. Checksum signing, preview transport, decisions, commit,
lineage, and auditing remain shared boundaries.

## Normalized data model

Extend circuits with:

- `renewal_procedure_start_date` for the workbook's explicit action-start date;
- structured segment and connected-router fields;
- raw cost details for compound or non-normalizable pricing.

Add a circuit-identifier relation containing identifier kind, original value,
normalized searchable value, and primary/alternate status. The existing
`external_circuit_id` remains the primary display and compatibility identifier.
Provider plus normalized primary identifier remains the duplicate boundary.

Existing fields continue to store service type, capacity, location, start date,
expiry date, monthly cost, currency, notes, verification state, notification
state, and source lineage.

## Sheet mappings

### IP Transit

Use the explicit provider and circuit ID. Map link type, capacity, segment,
router, activation, deactivation, procedure-start date, costs, and remarks.
Section headings are descriptive and do not override an explicit provider.

### Backhaul

Use the BSCPLC ID as the primary identifier and the provider ID as a searchable
alternate. If BSCPLC ID is blank, use provider ID as primary. Normalize provider
headings to canonical providers without retaining location text in provider
names.

### Internet Exchange

Use circuit ID as primary and customer/link ID as an alternate. Permission
expiry is authoritative because the apparent deactivation field can contain
contract narrative. Preserve that narrative in notes rather than parsing a
fictional date.

### Singapore Equinix

Use service-order number as primary and service type as the description. The
later billing section enriches an existing matching service order and adds a
second lineage record instead of creating a duplicate. Billing-only services
without expiry remain drafts. A continuation cost line enriches its parent
service and is not promoted to an identifier.

Multiline identifiers within one source row remain one service record. Their
individual values are searchable alternates; they do not create topology the
workbook does not assert.

## Dates, costs, and lifecycle

- Activation maps to start date.
- Deactivation maps to expiry except where an explicit permission-expiry field
  is authoritative.
- The workbook procedure-start date maps to
  `renewal_procedure_start_date`; if absent, notification logic falls back to
  the standard four-calendar-month calculation.
- Unambiguous single costs are parsed with their currency. Compound committed,
  burstable, bundled, or mixed-currency descriptions remain in raw cost details
  and are not reduced to misleading totals.
- Complete future records are imported as `active`, verified by the importing
  administrator, notification-enabled, and assigned
  `owner_override = "BSCPLC IIG Support"` until an individual owner is set.
- Complete records already past expiry are imported as `expired` with
  notifications disabled.
- Missing scheduler-critical dates produce `draft` records with notifications
  disabled. Dates are not inferred from remarks such as renewal duration.

## Preview, validation, and commit

Preview is read-only, bounded by the existing file restrictions, normalized,
and checksum-signed. These conditions block commit:

- unrecognized required sheet structure;
- missing primary identifier or provider;
- invalid or contradictory dates;
- conflicting primary duplicates that cannot be deterministically merged;
- tampered or expired preview signatures.

Missing optional metadata, compound pricing, ignored helper content, and unknown
extra cells are warnings. Extra cells are never silently discarded.

Commit uses one database transaction. It upserts canonical providers, creates or
merges services according to reviewed decisions, writes every applicable source
lineage record, records the importing administrator as verifier, and appends a
redacted audit entry. A commit failure retains no partial operational records.

## Structural acceptance expectations

The approved workbook structure is expected to preview approximately:

- 9 imported providers;
- 23 unique service/circuit records;
- 20 complete active records;
- 3 incomplete Equinix drafts;
- 1 Equinix duplicate merged by service-order identifier.

These values are a review invariant, not a reason to force parser output. A
material discrepancy stops before commit and requires source/adapter review.
Live commit is a separate operator-confirmation gate after preview approval.

## Testing and acceptance

- Use synthetic fixtures for each adapter, repeated headers, section headings,
  multiline values, blank internal IDs, narrative dates, two-table enrichment,
  continuation lines, compound costs, and helper-sheet exclusion.
- Test canonical provider aliases, primary/alternate identifier search,
  lifecycle classification, default support ownership, verification
  attribution, source lineage, duplicate decisions, checksums, signatures, and
  transaction rollback.
- Run typecheck, lint, the full test suite, production build, migration checks,
  and an authenticated production preview.
- After explicit approval, commit and verify providers, records, states, dates,
  identifiers, metadata, lineage, and audit output directly against production.

## Dependencies and non-goals

This work depends on the existing authenticated import boundaries and precedes
the notification catch-up release in the companion production-completion
specification. It does not import helper `Sheet1`, infer missing dates, model
invoice history, store the workbook, or create separate circuits from ambiguous
multiline values.
