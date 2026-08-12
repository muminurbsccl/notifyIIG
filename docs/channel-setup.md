# Provider channel configuration

Use the local operator CLI only after organizational approval for each channel.
The CLI is dry-run-first, uses the PostgreSQL session pooler from `DATABASE_URL`,
and applies all provider changes atomically.

## Prerequisites

- `.env.local` has `DATABASE_URL`, public Supabase URL, and a 32-byte raw or
  base64 `APP_ENCRYPTION_KEY` when using provider-specific Discord webhooks.
- `actorEmail` resolves to an active `admin` profile.
- Provider codes already exist in Supabase.
- Email provider, Meta template/opt-in, and Discord use are approved.

## Prepare the local file

```powershell
Copy-Item channel-config.example.json channel-config.local.json
```

`channel-config.local.json` is ignored by Git. Never paste this file, access
tokens, webhook URLs, or passwords into chat, issues, or logs.

Contacts have a stable local `key`. Email and WhatsApp recipient lists reference
those keys. WhatsApp recipients must have an active E.164 phone plus a timestamp
and source proving opt-in. Discord can use `{ "source": "global" }` with
`DISCORD_WEBHOOK_URL`, or `{ "source": "provider", "webhookUrl": "https://..." }`;
provider URLs are encrypted before storage.

## Dry run

```powershell
npm run channels:configure -- channel-config.local.json
```

Dry run opens a read-only transaction, validates the actor/providers/current
state, prints masked recipients and counts, then rolls back. It never prints BCC
identities, full recipients, webhooks, ciphertext, database credentials, or keys.

## Apply

```powershell
npm run channels:configure -- channel-config.local.json --apply
```

Apply requires an interactive terminal and asks you to type the exact project
reference. A mismatch exits without writes. All providers commit together; any
contact, settings, or audit failure rolls the entire transaction back safely.
Retry only after correcting the reported provider/contact field.

Exit codes: `0` success, `1` validation/database/encryption failure, `2` usage or
non-interactive apply, `3` confirmation rejected.

To disable a channel, set `enabled` to false and clear its routes/target. Contacts
not present in the file are preserved; the CLI does not delete or deactivate
unspecified contacts. Sending a test remains a separate administrator action at
**Settings → Channel test**.
