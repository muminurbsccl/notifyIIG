# Notice-date Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "Notice date" column (stored renewal procedure start date, falling back to expiry − 3 calendar months) with an "Overdue" flag on the dashboard "Upcoming expiries" table and the Circuits page table.

**Architecture:** Pure date helpers in `lib/domain/notice-date.ts` (reusing the existing `subtractCalendarMonths` from `lib/domain/date-rules.ts`), a shared `NoticeDateCell` component rendering a `<td>` with the date and optional overdue badge, then wire both server-component pages to it.

**Tech Stack:** Next.js (App Router, server components), TypeScript, vitest, existing CSS badge system (`badge badge-gold`), `app/globals.css`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-19-notice-date-column-design.md` (approved 2026-08-19).
- Notice date = `renewal_procedure_start_date` when non-null, else `subtractCalendarMonths(expiry_date, 3)`, else `null`.
- Overdue iff notice date is **strictly before** `businessDate` AND `expiry_date >= businessDate`. Notice equal to business date is NOT overdue. Circuits with null expiry are never flagged.
- Dashboard column order: `Due | Circuit | Provider | Status | Expiry date | Notice date`.
- Circuits page column order: `Circuit | Provider | Status | Action | Owner | Expiry date | Notice date`.
- Dashboard sort: overdue-notice circuits first (by notice date), then the rest by expiry date.
- No API, data-layer, or database schema changes. `listCircuits` already returns `renewal_procedure_start_date`.
- No new design tokens: reuse `badge badge-gold`; add exactly one CSS class `.notice-date-overdue` (gold text, semibold).
- All tests must pass and `npm run typecheck` must be clean before the final commit.

---

### Task 1: Notice-date domain helpers

**Files:**
- Create: `lib/domain/notice-date.ts`
- Test: `tests/notice-date.test.ts`

**Interfaces:**
- Consumes: `subtractCalendarMonths(value: string, months: number): string` from `@/lib/domain/date-rules` (already exists; throws on invalid input).
- Produces: `type NoticeDateCircuit = { expiry_date: string | null; renewal_procedure_start_date: string | null }`; `noticeDate(circuit: NoticeDateCircuit): string | null`; `isNoticeOverdue(circuit: NoticeDateCircuit, businessDate: string): boolean`. Later tasks rely on these exact names and signatures.

- [ ] **Step 1: Write the failing test**

Create `tests/notice-date.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/notice-date.test.ts`
Expected: FAIL — module `@/lib/domain/notice-date` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/domain/notice-date.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/notice-date.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/notice-date.ts tests/notice-date.test.ts
git commit -m "feat(notice): add notice-date and overdue helpers with tests"
```

---

### Task 2: NoticeDateCell component and overdue style

**Files:**
- Create: `components/notice-date-cell.tsx`
- Modify: `app/globals.css` (append `.notice-date-overdue` near the `.badge-*` rules, after line ~611)
- Test: `tests/notice-date-cell.test.ts`

**Interfaces:**
- Consumes: `noticeDate`, `isNoticeOverdue`, `NoticeDateCircuit` from `@/lib/domain/notice-date`.
- Produces: `<NoticeDateCell circuit={circuit} businessDate={businessDate} />` — a `ReactElement` that renders a `<td>` (the caller places it directly inside `<tr>`). Both pages use this exact component in Task 3 and Task 4.

- [ ] **Step 1: Write the failing component test**

Create `tests/notice-date-cell.test.ts` (follows the existing `renderToString` pattern from `tests/import-review-summary.test.ts`):

```ts
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoticeDateCell } from "@/components/notice-date-cell";
import type { NoticeDateCircuit } from "@/lib/domain/notice-date";

describe("NoticeDateCell", () => {
  it("renders the stored procedure date with an Overdue badge when overdue", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2026-08-19",
      renewal_procedure_start_date: "2026-05-01",
    };
    const html = renderToString(createElement(NoticeDateCell, { circuit, businessDate: "2026-08-19" }));
    expect(html).toContain("2026-05-01");
    expect(html).toContain("badge-gold");
    expect(html).toContain("Overdue");
  });

  it("renders the fallback date without a badge when not overdue", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: "2027-02-18",
      renewal_procedure_start_date: null,
    };
    const html = renderToString(createElement(NoticeDateCell, { circuit, businessDate: "2026-08-19" }));
    expect(html).toContain("2026-11-18");
    expect(html).not.toContain("badge-gold");
    expect(html).not.toContain("Overdue");
  });

  it("renders an em dash when there is no notice date", () => {
    const circuit: NoticeDateCircuit = {
      expiry_date: null,
      renewal_procedure_start_date: null,
    };
    const html = renderToString(createElement(NoticeDateCell, { circuit, businessDate: "2026-08-19" }));
    expect(html).toContain("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/notice-date-cell.test.ts`
Expected: FAIL — module `@/components/notice-date-cell` cannot be resolved.

- [ ] **Step 3: Write the minimal implementation**

Create `components/notice-date-cell.tsx`:

```tsx
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
```

- [ ] **Step 4: Add the overdue style**

Append to `app/globals.css` right after the `.badge-neutral` rule (ends around line 611):

```css
.notice-date-overdue {
  color: var(--gold-700);
  font-weight: 600;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/notice-date-cell.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add components/notice-date-cell.tsx tests/notice-date-cell.test.ts app/globals.css
git commit -m "feat(notice): render notice date cell with overdue badge"
```

---

### Task 3: Dashboard integration (column + sort)

**Files:**
- Modify: `app/(app)/dashboard/page.tsx` (add imports; add `<th>` after "Expiry date"; replace the `upcoming` render body cell list with the new cell; re-sort `upcoming`)

**Interfaces:**
- Consumes: `NoticeDateCell` from `@/components/notice-date-cell`; `isNoticeOverdue` and `noticeDate` from `@/lib/domain/notice-date`; existing local `businessDate` (`getDhakaBusinessDate()`) and `upcoming` array.
- Produces: nothing new — later tasks do not depend on this file.

- [ ] **Step 1: Add the imports**

At the top of `app/(app)/dashboard/page.tsx`, after the existing imports:

```tsx
import { NoticeDateCell } from "@/components/notice-date-cell";
import { isNoticeOverdue, noticeDate } from "@/lib/domain/notice-date";
```

- [ ] **Step 2: Re-sort the upcoming list**

Replace the existing `upcoming` declaration (the `const upcoming = circuits.filter(...).sort(...)` block, currently lines 61-63) with:

```tsx
  const upcoming = circuits
    .filter((circuit) => circuit.expiry_date && circuit.expiry_date >= businessDate)
    .sort((a, b) => {
      const aOverdue = isNoticeOverdue(a, businessDate);
      const bOverdue = isNoticeOverdue(b, businessDate);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      if (aOverdue && bOverdue) {
        return String(noticeDate(a)).localeCompare(String(noticeDate(b)));
      }
      return String(a.expiry_date).localeCompare(String(b.expiry_date));
    });
```

- [ ] **Step 3: Add the column header and cell**

In the table header, after `<th>Expiry date</th>` add:

```tsx
                  <th>Notice date</th>
```

In the row body, after `<td>{circuit.expiry_date}</td>` add:

```tsx
                    <NoticeDateCell circuit={circuit} businessDate={businessDate} />
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/notice-date.test.ts tests/notice-date-cell.test.ts`
Expected: PASS. Then run `npm run typecheck` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): show notice date column with overdue-first sort"
```

---

### Task 4: Circuits page integration

**Files:**
- Modify: `app/(app)/circuits/page.tsx` (add imports; add `<th>` after "Expiry date"; add cell after the expiry `<td>`)

**Interfaces:**
- Consumes: `NoticeDateCell` from `@/components/notice-date-cell`; `getDhakaBusinessDate` from `@/lib/domain/date-rules`.
- Produces: nothing new.

- [ ] **Step 1: Add the imports**

At the top of `app/(app)/circuits/page.tsx`, after the existing imports:

```tsx
import { NoticeDateCell } from "@/components/notice-date-cell";
import { getDhakaBusinessDate } from "@/lib/domain/date-rules";
```

- [ ] **Step 2: Compute the business date**

Inside `CircuitsPage`, right after `const providers = await listProviders(auth.supabase);` (currently line 23) add:

```tsx
  const businessDate = getDhakaBusinessDate();
```

- [ ] **Step 3: Add the column header and cell**

In the table header, after `<th>Expiry date</th>` add:

```tsx
                <th>Notice date</th>
```

In the row body, after `<td>{circuit.expiry_date ?? "—"}</td>` add:

```tsx
                  <NoticeDateCell circuit={circuit} businessDate={businessDate} />
```

- [ ] **Step 4: Verify the full suite**

Run: `npx vitest run`
Expected: PASS — 288 tests (277 existing + 8 notice-date + 3 notice-date-cell).
Then run `npm run typecheck` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/circuits/page.tsx"
git commit -m "feat(circuits): show notice date column with overdue flag"
```