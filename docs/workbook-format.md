# Workbook import format

The import workflow reads the **first worksheet** of an `.xlsx`/`.xls` file (≤ 5 MB).
A fillable example lives at `docs/workbook-template.xlsx` (matches the legacy
BSCPLC workbook layout: provider sections with per-provider tables).

## Layout

1. **Provider sections** — a row containing exactly one cell with a provider
   name (before the header row, or between data rows) starts a provider
   section. The name applies to all following data rows.
2. **Header row** — a row whose cells include at least one recognized header
   name (matching is case-insensitive and ignores punctuation/spacing):

   | Column | Accepted header names |
   | --- | --- |
   | Provider | `Provider`, `Provider Name`, `Vendor` |
   | Identifier | `Circuit Link ID`, `Circuit ID`, `Link ID`, `Circuit Link Identifier` |
   | Invoice | `Invoice No`, `Invoice Number`, `Invoice Reference` |

   The identifier column name must contain the word "link" for rows to be
   treated as link records (otherwise they are treated as plain circuit IDs).
3. **Data rows** — one row per circuit link and/or invoice reference. A row
   with an identifier creates a circuit candidate; a row with an invoice
   number creates an invoice reference. Both on the same row are kept as
   separate objects.

## Rules and warnings

- A data row without a provider value inherits the active provider section.
- Identifier values are canonicalized to upper case with single spaces
  (`NTT-IPLC-0001` → `NTT-IPLC-0001`).
- The same provider + identifier appearing twice produces a
  **DUPLICATE_IDENTIFIER** issue requiring a per-row decision
  (skip / merge / create) before commit.
- Values that look like invoice numbers (`invoice …`, `inv …`) in the
  identifier column are treated as invoice references, not circuit IDs
  (**INVOICE_ONLY**).
- Identifiers containing "ip" and "lag", "bundle", or "multiple records" are
  flagged **AMBIGUOUS_IDENTIFIER** for manual normalization.
- A row with only an invoice number requires manual circuit association later
  (**INVOICE_ONLY**).
- A row with neither identifier nor invoice is rejected
  (**MISSING_IDENTIFIER**).
- The second worksheet (named `Sheet2` or similar) is never imported and is
  intended for manual review notes.

## After import

Review the preview, resolve every duplicate decision, then **commit**. Circuit
records still need completion in **Circuits** (verified expiry date, owners,
start date, monthly cost) before notifications can be enabled — circuits
without an expiry date cannot send notifications.
