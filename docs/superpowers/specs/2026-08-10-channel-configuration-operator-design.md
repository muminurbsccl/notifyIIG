# Channel Configuration Operator Design

**Date:** 2026-08-10
**Status:** Approved design, pending written-spec review
**Scope:** A local, database-backed operator CLI for configuring provider contacts and notification channels safely.

## Objective

Provide an administrator with a repeatable way to configure provider contacts,
email routing, WhatsApp opt-ins, and Discord routing from a local JSON file. The
tool must default to a read-only dry run and must not modify Supabase unless the
operator passes `--apply` and types the exact project reference.

The tool is operational tooling, not an application API. It connects through
`DATABASE_URL`, performs an atomic transaction, and records actor-attributed
audit entries. It must never print credentials, full recipients, webhook URLs,
encryption keys, or ciphertext.

## Operator Interface

```powershell
# Validate and preview only (default)
node --env-file=.env.local scripts/configure-channels.mjs channel-config.local.json

# Validate, preview, require typed project confirmation, then apply atomically
node --env-file=.env.local scripts/configure-channels.mjs channel-config.local.json --apply
```

`--apply` requires an interactive terminal. There is deliberately no `--yes`,
non-interactive, or CI bypass in this version.

The repository will track `channel-config.example.json`. `.gitignore` will
exclude `channel-config*.json` and then explicitly allow the example file.

## Configuration Format

The JSON document has a versioned top-level schema:

```json
{
  "version": 1,
  "projectRef": "mxmlsxbhxuxjecaxqrnt",
  "actorEmail": "operator@example.com",
  "providers": [
    {
      "code": "NTT",
      "contacts": [
        {
          "key": "noc-primary",
          "id": null,
          "contactType": "recipient",
          "name": "NOC Primary",
          "roleTitle": "Network Operations",
          "email": "noc@example.com",
          "phoneE164": "+8801000000000",
          "whatsappOptIn": {
            "at": "2026-08-10T00:00:00Z",
            "source": "written-consent-reference"
          },
          "active": true
        }
      ],
      "channels": {
        "email": {
          "enabled": true,
          "to": ["noc-primary"],
          "cc": [],
          "bcc": [],
          "replyTo": null,
          "subjectPrefix": "[Circuit Expiry]",
          "templateOverride": null
        },
        "whatsapp": {
          "enabled": true,
          "recipients": ["noc-primary"],
          "templateName": "circuit_expiry_notice"
        },
        "discord": {
          "enabled": false,
          "target": null,
          "mentionIds": []
        }
      }
    }
  ]
}
```

Each contact has a unique local `key` within its provider. Channel recipient
lists reference these keys. `id` is optional; when supplied it must be a UUID
belonging to the same provider.

Discord `target`, when enabled, is exactly one of:

```json
{ "source": "provider", "webhookUrl": "https://discord.com/api/webhooks/..." }
```

or:

```json
{ "source": "global" }
```

The global option requires `DISCORD_WEBHOOK_URL` in the process environment and
stores no per-provider webhook ciphertext. The provider option encrypts the URL
in memory and stores only ciphertext.

## Validation and Preflight

The CLI completes all validation before opening a write transaction:

1. Parse JSON and validate `version: 1`; reject unknown fields to catch typos.
2. Require `DATABASE_URL`, `APP_ENCRYPTION_KEY` when provider Discord encryption
   is requested, and `DISCORD_WEBHOOK_URL` when global Discord is selected.
3. Confirm `projectRef` matches `NEXT_PUBLIC_SUPABASE_URL` and, when present,
   the `postgres.<project-ref>` tenant in `DATABASE_URL`.
4. Resolve `actorEmail` to one active profile with role `admin`.
5. Resolve every provider code case-insensitively to exactly one existing row.
6. Require provider codes and contact keys to be unique in the input.
7. Validate contact type, UUID, email shape, E.164 phone format, ISO timestamp,
   and non-empty WhatsApp opt-in source.
8. Require each enabled email channel to have at least one active contact with
   an email in `to`; all `to`/`cc`/`bcc` keys must resolve to email contacts.
9. Require each enabled WhatsApp recipient to be active and have an E.164 phone,
   opt-in timestamp, and opt-in source.
10. Require enabled Discord to have one valid target and HTTPS webhook URLs;
    mention IDs must contain digits only and must not include mass mentions.
11. Reject duplicate normalized email or phone identities within a provider.
12. Read current contacts/settings and ensure contact matching is unambiguous.

The encryption key parser will be shared with application target encryption. It
accepts either a raw UTF-8 string of exactly 32 bytes or base64 text that decodes
to exactly 32 bytes. Existing AES-256-GCM payloads retain the same
`iv:authTag:ciphertext` base64 format.

## Contact Matching and Update Semantics

Matching uses this order:

1. explicit contact `id`;
2. normalized lowercase email;
3. normalized E.164 phone.

If email and phone identify different existing rows, or either identity matches
more than one row, validation fails. A match updates that row; no match inserts
a new row. Contacts absent from the input remain unchanged—this tool does not
delete or deactivate unspecified contacts.

Provider notification settings are a complete desired state for the three
channel blocks in the JSON and are upserted on `provider_id`. Recipient contact
keys are converted to database contact UUIDs. Reapplying an unchanged file is
idempotent except that provider Discord encryption uses a fresh random IV; the
dry-run comparison therefore compares decrypted target identity or target hash,
not ciphertext bytes.

## Dry Run and Redacted Preview

Dry run connects read-only, performs all database preflight checks, and prints a
provider-by-provider summary:

- provider code;
- contacts to insert or update;
- masked email and WhatsApp values using existing masking rules;
- enabled/disabled state for each channel;
- masked recipient routes and recipient counts;
- `configured`, `changed`, or `removed` for Discord target state;
- validation errors and warnings.

It never prints `DATABASE_URL`, project password, plaintext webhook URLs,
`APP_ENCRYPTION_KEY`, access tokens, full email addresses, full phone numbers,
ciphertext, BCC recipients, or global webhook values.

## Apply Flow and Atomicity

With `--apply`, the CLI first prints the same dry-run preview. It then prompts:

```text
Type project reference mxmlsxbhxuxjecaxqrnt to apply these changes:
```

Any mismatch or non-interactive stdin exits without writes. After confirmation:

1. begin one PostgreSQL transaction;
2. lock the selected provider, contact, settings, and actor rows as needed;
3. repeat project, actor, provider, and ambiguity checks inside the transaction;
4. insert/update contacts and collect their UUIDs;
5. upsert provider notification settings;
6. call `public.append_audit_log` for each changed provider;
7. commit only after every provider succeeds; otherwise roll back all changes.

Audit action is `provider.channels.configure`, entity type is `provider`, and
entity ID is the provider UUID. Before/after audit JSON contains only channel
booleans, masked recipient summaries/counts, contact operation counts, and
Discord configured state. It does not contain plaintext recipients, webhook
URLs, ciphertext, BCC identities, or encryption material. The existing database
audit trigger provides an additional redaction layer.

## Internal Boundaries

Implementation is split into focused units:

- `scripts/configure-channels.mjs`: CLI parsing, prompt, exit codes, orchestration.
- `scripts/lib/channel-config.mjs`: strict JSON schema, normalization, validation,
  matching, redacted preview, transaction operations.
- shared crypto/key parsing used by both the application and CLI, preserving the
  current ciphertext format.
- `channel-config.example.json`: placeholder-only schema example.
- `docs/channel-setup.md`: operator runbook and rollback/recovery guidance.

Database credentials remain environment-only. The JSON file contains channel
recipient data and potentially plaintext provider Discord webhooks, so local
configuration files are git-ignored and must be stored according to BSCPLC's
credential-handling policy.

## Error Handling and Exit Codes

- `0`: successful dry run or successful apply;
- `1`: validation, database, encryption, or transaction failure;
- `2`: CLI usage error, missing arguments, invalid flags, or non-interactive
  apply attempt;
- `3`: operator confirmation rejected or cancelled.

Errors identify the provider/contact key and violated rule but never echo the
sensitive input value. Transaction failures report rollback explicitly.

## Testing and Verification

Tests use mocked PostgreSQL boundaries or a deterministic fake transaction; they
must not connect to the live project. Coverage includes:

- strict schema acceptance/rejection and unknown fields;
- project and actor preflight;
- email, E.164, opt-in, Discord, mention, and duplicate validation;
- contact matching precedence and ambiguity rejection;
- masking/redaction and assurance that secrets never appear in preview output;
- raw/base64 encryption key compatibility and ciphertext round-trip;
- dry-run performs no writes;
- typed confirmation rejection performs no writes;
- atomic rollback when any provider operation fails;
- audit payload redaction;
- idempotent contact/settings re-apply;
- CLI exit codes.

Repository verification after implementation:

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
node --env-file=.env.local scripts/configure-channels.mjs channel-config.example.json
```

The example dry run may stop at database/provider placeholder validation, but it
must parse safely and must not write or print secrets.

## Non-Goals

- No browser UI for contact/channel configuration.
- No deletions of contacts absent from the JSON.
- No CI/non-interactive apply bypass.
- No automatic enabling of production channel credentials.
- No live channel send as part of configuration; channel tests remain a separate
  administrator approval step in Settings.

## Acceptance Criteria

1. Default invocation is read-only and prints a fully redacted diff.
2. `--apply` cannot write without exact typed project confirmation.
3. All provider changes commit together or all roll back.
4. Only an active admin profile can be the audit actor.
5. WhatsApp cannot be enabled for a contact without recorded opt-in evidence.
6. Provider Discord webhooks are encrypted compatibly with the notification
   engine, and no plaintext is logged or audited.
7. Existing unrelated contacts are preserved.
8. Reapplying the same desired state creates no duplicate contacts and no
   semantic settings changes.
9. Tests and the full repository verification suite pass.
