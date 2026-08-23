# Invitation-Only User Administration and Notification Quality Design

## Goals

1. Keep registration invitation-only while allowing administrators to manage application users.
2. Make circuit and provider responsibility assignment usable through active-user selectors rather than raw UUID entry.
3. Provide a professional, branded HTML expiry-notification email with a plain-text fallback.
4. Give administrators a reliable way to verify configured email, WhatsApp, and Discord channels.

## Access and User Management

- There is no public signup flow and no action uses `shouldCreateUser: true`.
- Add an admin-only Users page and navigation entry.
- Admins can create/invite a user, edit full name, role, active state, and provider access, set a password, and delete a user.
- The initial requested accounts are provisioned operationally, not from source code: `support.iig@bsccl.com` is an active viewer and `muminurbsccl@gmail.com` is an admin.
- Passwords are sent only to Supabase Auth through the service-role admin API; they are never stored in source, database profile rows, logs, audit payloads, or client HTML.
- An administrator cannot delete, deactivate, or demote the last active administrator, and cannot delete their own account through the UI.
- All user-management API routes require `requireApiProfile(["admin"])` and redact provider/API errors.

## Responsibility Assignment

- Load active profiles for admin/editor circuit and provider forms.
- Display name and email in owner selectors, while submitting UUIDs.
- Preserve the existing free-text `ownerOverride` field for operational labels such as a team or external responsible officer.
- Server validation and existing database triggers remain authoritative for active-user ownership.

## Notification Email

- Keep the existing channel adapter contract (`bodyHtml` and `bodyText`).
- Replace the one-line HTML fragment with a responsive email-safe table layout containing BSCPLC branding, urgency/milestone, circuit ID, expiry date, a clear action message, and a footer.
- Escape all dynamic values and retain a plain-text alternative.
- Preserve template overrides when configured; professional HTML is the default when no override exists.
- Existing WhatsApp and Discord payload contracts remain unchanged.

## Verification

- Unit tests cover admin authorization, user CRUD validation, self/last-admin protections, password-update redaction, profile selector data, and professional HTML escaping/content.
- Existing channel adapter tests remain green.
- Run the full test suite and typecheck.
- Use the admin Settings channel-test controls to send controlled test messages for each configured channel; verify delivery externally and confirm delivery records/audit entries.
- Deploy to Vercel and smoke-test Users, Settings, Circuits, Providers, and Notifications pages.
