# BSCPLC Circuit Expiry Notification System

Secure upstream circuit expiry tracking and notification operations for BSCPLC.

- **Stack:** Next.js 15 (App Router) on Vercel, Supabase (Postgres + Auth + RLS)
- **Production URL:** `https://notifyiig.vercel.app`
- **Scheduled job:** daily `0 3 * * *` UTC via `vercel.json` cron → `GET /api/cron/expiry-notifications`
- **Repository:** `https://github.com/muminurbsccl/notifyIIG`

> **Hosting approval gate:** Vercel Hobby is suitable for technical
> proof-of-concept use only. Confirm an approved organizational production plan
> before go-live. Do not store production channel credentials until this plan
> is approved.

The production deployment is linked to
`https://github.com/muminurbsccl/notifyIIG` on branch `master`. Verified
production checks: `/login` returns `200`, unauthenticated `/dashboard`
redirects to `/login`, cron without the bearer secret returns `401`, and an
authenticated zero-circuit cron run returns `200` with zero delivery counts.

---

## 1. Create the Supabase project and run the migration

1. Create a Supabase project and note its **Project URL**, **anon/publishable key**
   and **service role key** (Dashboard → Project Settings → API).
2. Open the project's **SQL Editor** and run the files in order:
   - `supabase/migrations/001_initial.sql`
   - `supabase/seed.sql` (safe draft-only provider data + default notification rule)

   Alternatively, apply both files with the bundled runner (requires
   `DATABASE_URL` in `.env.local`, e.g. the IPv4 session pooler
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`):

   ```powershell
   node --env-file=.env.local scripts/apply-sql.mjs supabase/migrations/001_initial.sql supabase/seed.sql
   ```

3. Verify with:

   ```sql
   select count(*) from public.circuits;          -- 0
   select code from public.notification_rules;     -- global-default
   select count(*) from public.notification_milestones; -- 3 (T-4M, T-30D, T-0)
   ```

## 2. Invite the first user and activate their profile

1. Dashboard → Authentication → Users → **Invite user** with the operator's email.
2. Have the operator sign in once at `/login` (the signup trigger creates their
   profile with role `viewer` and `active = false`).
3. As the database owner, promote them in the SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin', active = true
   where email = 'operator@bscplc.example';
   ```

4. They can now sign in at `/login` and reach `/dashboard`. Other roles:
   `operations_editor`, `provider_manager`, `auditor`, `viewer`.

### Hosted Auth URL configuration

Before testing a production magic link, open **Supabase Dashboard →
Authentication → URL Configuration** and set:

- **Site URL:** `https://notifyiig.vercel.app`
- **Redirect URL:** `https://notifyiig.vercel.app/auth/callback`

Keep `http://localhost:3000/auth/callback` as a separate development redirect.
Do not enable wildcard preview callbacks unless a preview-auth policy is
approved. Set Vercel `APP_BASE_URL=https://notifyiig.vercel.app` and redeploy
after changing it. Verify one password login and one newly requested production
magic link; both must reach `/dashboard`. An expired/reused link must return a
generic message on `/login` and must not expose its code or provider response.

## 3. Import workbook data and complete current records

1. Sign in as an administrator and open **Imports**.
2. Upload the provider/circuit workbook (first worksheet; `.xlsx`/`.xls`, ≤ 5 MB).
   See `docs/workbook-format.md` for the expected layout and
   `docs/workbook-template.xlsx` for a fillable template.
3. Review providers, circuit candidates and invoice references, resolve every
   duplicate identifier (`skip` / `merge` / `create`) and commit.
4. Open **Circuits** and complete the current picture for each record:
   verified expiry dates, owners, start dates, monthly costs, and enable
   notifications. Circuits without an expiry date cannot send notifications —
   the import review warns about this explicitly.
5. Register `provider_contacts` and `provider_notification_settings` rows for
   each provider in the SQL Editor (recipient emails, WhatsApp numbers with
   opt-in timestamps, Discord webhook ciphertext). The notification engine only
   sends to resolved, opted-in recipients.

## 4. Create the Vercel project and environment values

1. Initialize Git and push the repository to your Git provider.
2. In Vercel: **Add New Project** → import the repository (framework preset:
   Next.js). The `vercel.json` cron is picked up automatically on Hobby and up.
3. Add **separate** environment values for Preview and Production from
   `env.example` — see the table below. Production values must be real
   approved credentials; Preview may use safe test values.

| Variable | Public? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Publishable (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Server-only: imports, audit, cron engine |
| `CRON_SECRET` | no | Bearer secret for the scheduled job |
| `APP_BASE_URL` | no | Canonical deployment URL |
| `APP_ENCRYPTION_KEY` | no | 32-byte key (base64 or raw) for target encryption and preview signing |
| `EMAIL_API_URL` / `EMAIL_API_KEY` | no | Transactional email provider endpoint/key |
| `EMAIL_FROM` / `EMAIL_FROM_NAME` | no | Sender identity |
| `WHATSAPP_API_VERSION` | no | Graph API version (default `v22.0`) |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | no | WhatsApp Cloud API credentials |
| `WHATSAPP_TEMPLATE_NAME` | no | Approved template used by the engine |
| `DISCORD_WEBHOOK_URL` | no | Optional incoming webhook |

Generate secrets locally, e.g.:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # APP_ENCRYPTION_KEY
```

> `APP_ENCRYPTION_KEY` must be exactly 32 bytes. If it is changed after
> deliveries are stored, previously encrypted targets cannot be decrypted.

## 5. Set the cron secret and verify the route

1. Confirm `CRON_SECRET` is set in the deployment environment.
2. From a machine that can reach the deployment:

   ```powershell
   # Without the secret -> 401
   Invoke-WebRequest -Uri "https://<project>.vercel.app/api/cron/expiry-notifications" -SkipHttpErrorCheck | Select-Object StatusCode

   # With the secret -> 200 { "ok": true, "businessDate": "…", "counts": {…} }
   Invoke-WebRequest -Uri "https://<project>.vercel.app/api/cron/expiry-notifications" `
     -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } | Select-Object -ExpandProperty Content
   ```

3. The Vercel cron fires at `0 3 * * *` UTC (Dhaka business date). A manual run
   via the authenticated request above is always safe — the engine is
   idempotent per `(circuit_id, expiry_version, milestone_key)` and per
   delivery `idempotency_key`.

4. Every successful cron call writes a redacted audit record with
   `action: notification.expiry.cron.run`, `actorUserId: null`, and
   `after: { businessDate, counts }` so no recipients/ciphertexts are ever
   surfaced.

5. Concurrency hardening validation (local test DB only):

   ```powershell
   $env:ALLOW_NOTIFICATION_CLAIM_TEST = "true"
   node --env-file=.env.local scripts/verify-notification-claims.mjs
   ```

   Expected: `PASS: concurrent claims were disjoint`. Never run this script
   against production or non-test hosts.

## 6. Configure channels after organizational approval

Use `docs/channel-setup.md` for the dry-run-first provider contact and routing
operator. Start with `npm run channels:configure -- channel-config.local.json`;
database writes additionally require `--apply` and typed project confirmation.

- **Email:** point `EMAIL_API_URL`/`EMAIL_API_KEY` at the approved provider and
  sender. The adapter posts JSON with `from`, `to`, `cc`, `bcc`, `replyTo`,
  `subject`, `html` and `text`.
- **WhatsApp:** submit the template (variables: circuit ID, expiry date,
  milestone label) in Meta Business Manager, confirm its status is
  **Approved**, and record opt-in consent timestamps in
  `provider_contacts.whatsapp_opt_in_at`. The engine only sends to opted-in
  E.164 numbers.
- **Discord:** create an incoming webhook and store its URL in
  `DISCORD_WEBHOOK_URL` or per-provider ciphertext. Mentions are always
  allow-listed; `@everyone`/`@here` are stripped.
- Approval is required **before** storing production channel credentials.

## 7. Brand assets and tokens

- Replace the placeholder brand mark in `components/brand-logo.tsx` with the
  official BSCPLC logo asset.
- Update approved brand tokens in `app/globals.css` (`:root` color variables:
  `--blue-*`, `--green-*`, `--red-*`, `--gold-*`, `--ink`, `--muted`, `--line`).

## 8. Go-live checks

1. **Channel tests:** as an administrator, open **Settings → Channel test** and
   send to a target you control (WhatsApp requires opt-in metadata).
2. **Workflow:** create a circuit as `draft`, then edit it to `active` with a
   verified expiry date and owner; confirm the first-reminder date is shown and
   the record appears in the Dashboard KPIs.
3. **History:** inspect **Notifications** (events + masked deliveries) and the
   read-only **Audit log** after a cron run.
4. **Approval:** sign off the hosting plan (see the warning above) and record
   the approved review in the deployment notes.
5. **Claims test:** run `node --env-file=.env.local scripts/verify-notification-claims.mjs`
   with `ALLOW_NOTIFICATION_CLAIM_TEST=true` only on localhost or a `_test`
   database, then confirm expected event/delivery counts before first live send.
6. **Public routes:** confirm `/login`, `/robots.txt`, `/icon.png`, and
   `/apple-icon.png` return `200`; unauthenticated `/dashboard` must redirect to
   `/login`. `/auth/callback` without a code must safely redirect to
   `/login?error=invalid-link`.
7. **Lighthouse:** run clean production audits at least three times per form
   factor and retain reports outside Git:

   ```powershell
   npx --yes lighthouse "https://notifyiig.vercel.app/login" --only-categories=performance,accessibility,best-practices,seo --output=html --output-path="$env:TEMP\notifyiig-mobile.html" --chrome-flags="--headless --incognito"
   npx --yes lighthouse "https://notifyiig.vercel.app/login" --preset=desktop --only-categories=performance,accessibility,best-practices,seo --output=html --output-path="$env:TEMP\notifyiig-desktop.html" --chrome-flags="--headless --incognito"
   ```

   The acceptance target is 100 in Performance, Accessibility, Best Practices,
   and SEO in a representative clean run for both mobile and desktop. Repeated
   runs expose hosting variance; do not commit the reports.

---

## Development

```powershell
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

### Performance

Server-rendered pages are optimized to minimize Supabase round trips per
navigation:

- Authentication is resolved once per request (React `cache()` dedupes the
  layout and page `requireProfile()` calls), and middleware no longer performs
  a profiles query — active/role checks stay in the page/API layer.
- Independent page queries run in parallel (`Promise.all`).
- Provider lists and the admin owner-selector list use a 15-second in-process
  TTL cache keyed by profile id, because RLS scopes those rows per user.
  Circuits are always read fresh.
- A route-level `loading.tsx` skeleton renders instantly during navigation.

Deployment: co-locate compute with the database. The Supabase project runs in
`ap-south-1`, so set the Vercel Function Region to Mumbai (`bom1`) under
Project Settings → Functions. On Hobby this is a dashboard setting; the
`regions` field in `vercel.json` requires Pro and is intentionally omitted.

## Security notes

- Server-only values are never rendered client-side; forms display
  configured/not-configured status only.
- Notification targets are stored as a SHA-256 hash plus AES-256-GCM
  ciphertext; the UI shows masked targets only.
- API errors never echo secrets; audit values are redacted before storage.
- The cron route returns counts only — never recipient payloads or secrets.
