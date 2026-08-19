# Notice-date column (dashboard + circuits)

Date: 2026-08-19
Status: Approved

## Problem

The operator needs a visible "date of notice" (renewal notice date, 3 months
prior to expiry) on the dashboard so renewal actions are taken on time. The
system already stores the contractually derived `renewal_procedure_start_date`
per circuit (parsed from the operator workbook, e.g. SGX "inform before 3
months of validity" = 21-Oct-26 for an 18-Feb-27 expiry), but it is not shown
anywhere in the UI.

## Decisions (approved)

1. **Source of the notice date:** use the stored `renewal_procedure_start_date`
   when present; otherwise compute `expiry_date − 3 calendar months`
   (calendar-month convention, same as the dashboard's existing "expiring
   within 4 months" helper; month-end dates clamp, e.g. `2026-05-31 → 2026-02-28`).
2. **Overdue flag:** when the notice date is before today **and** the expiry is
   still on/after today, render the date in warning tint with a small "Overdue"
   badge (reusing existing badge styles). No flag once the circuit has expired
   or terminated (the window is moot).
3. **Scope:** both the dashboard "Upcoming expiries" table and the Circuits
   page table get the new column.
4. **Sorting:** on the dashboard, circuits with overdue notice dates float to
   the top (sorted by notice date within that group); the rest stay sorted by
   expiry date.

## Behavior

- `noticeDate(circuit)`:
  - `renewal_procedure_start_date` when non-null;
  - else `addCalendarMonths(expiry_date, -3)` when `expiry_date` non-null;
  - else `null`.
- `isNoticeOverdue(circuit, businessDate)`:
  - true iff `noticeDate(circuit) !== null`, `noticeDate < businessDate`, and
    `expiry_date >= businessDate`.
- Circuits without an expiry date display `—` in the new column and are never
  flagged.

## UI placement

- **Dashboard** "Upcoming expiries" (`app/(app)/dashboard/page.tsx`):
  columns become `Due | Circuit | Provider | Status | Expiry date | Notice date`.
  Rows re-sorted: overdue-notice circuits first (by notice date), then the rest
  by expiry date (unchanged).
- **Circuits** page (`app/(app)/circuits/page.tsx`): columns become
  `Circuit | Provider | Status | Action | Owner | Expiry date | Notice date`.
  Overdue flag applies only when the circuit has not expired yet (expiry on/after
  business date).

## Implementation

- New module `lib/domain/notice-date.ts` with `noticeDate(circuit)` and
  `isNoticeOverdue(circuit, businessDate)`. Move the dashboard's
  `addCalendarMonths` helper there (shared by both pages; keep
  `addCalendarDays`/`monthLabel` local to the dashboard).
- Both pages are server components (`force-dynamic`) — the column is computed
  during render; no API or data-layer changes (`listCircuits` already selects
  `*`, including `renewal_procedure_start_date`).
- Overdue rendering: reuse existing badge/warning styles (e.g.
  `badge badge-warning` if present in the stylesheet, else the existing
  warning text style) so no new design tokens are introduced.

## Testing

- `tests/notice-date.test.ts`:
  - stored date wins over computed fallback;
  - fallback = expiry minus 3 calendar months with month-end clamping;
  - null expiry → null notice date;
  - overdue boundary: notice strictly before business date is overdue; notice
    equal to business date is not overdue; expired circuit (expiry < business
    date) is never overdue.
- Run full `vitest` suite; ensure no regressions.

## Out of scope

- No changes to the import pipeline, notifications engine, or database schema.
- No changes to circuit detail page or notification pages.
