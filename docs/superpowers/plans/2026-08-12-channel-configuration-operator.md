# Channel Configuration Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dry-run-first, interactive Node CLI that validates a local JSON configuration and atomically configures provider contacts and email, WhatsApp, and Discord notification settings in Supabase.

**Architecture:** A shared ESM crypto core keeps Next.js and the Node CLI ciphertext-compatible. Pure configuration code parses, validates, masks, and plans changes without database writes; a separate PostgreSQL adapter performs preflight reads and one atomic transaction. The thin CLI handles files, flags, typed confirmation, redacted output, and exit codes.

**Tech Stack:** Node.js 24+, ECMAScript modules, TypeScript, Zod 3, `pg` 8, AES-256-GCM (`node:crypto`), Vitest 3, Next.js 15.

## Global Constraints

- Default invocation is a read-only dry run; database writes require `--apply` and exact typed project-reference confirmation.
- There is no `--yes`, CI bypass, or non-interactive apply mode.
- Every provider change commits in one PostgreSQL transaction or all changes roll back.
- Configuration files matching `channel-config*.json` are ignored; only `channel-config.example.json` is tracked.
- Never print database credentials, access tokens, encryption keys, plaintext webhook URLs, full email addresses, full phone numbers, ciphertext, BCC identities, or global webhook values.
- Only an active profile with role `admin` can be the audit actor.
- Existing contacts absent from the JSON remain unchanged; this tool never deletes or deactivates unspecified contacts.
- WhatsApp recipients require active contacts, E.164 phone numbers, and both opt-in timestamp and source.
- Discord provider webhooks use the existing AES-256-GCM `iv:authTag:ciphertext` base64 format.
- `APP_ENCRYPTION_KEY` accepts either exactly 32 raw UTF-8 bytes or base64 text decoding to exactly 32 bytes.
- Do not connect tests to the live Supabase project.
- Do not commit unless the user explicitly requests a commit; each task ends with a review checkpoint instead.

## File Structure

- Create `lib/notifications/target-crypto-core.mjs`: runtime-neutral key parsing, encryption, decryption, and masking used by both app and CLI.
- Create `lib/notifications/target-crypto-core.d.mts`: TypeScript declarations for the shared ESM core.
- Modify `lib/notifications/target-crypto.ts`: server-only wrapper/re-export preserving existing imports.
- Create `tests/target-crypto.test.ts`: raw/base64 key and compatibility tests.
- Create `scripts/lib/channel-config.mjs`: strict Zod schema, normalization, cross-field validation, contact matching, desired-state planning, and redacted preview formatting.
- Create `tests/channel-config.test.mjs`: pure validation, masking, matching, and redaction tests.
- Create `scripts/lib/channel-config-db.mjs`: PostgreSQL preflight, dry-run read-only transaction, atomic apply, settings upsert, and audit append.
- Create `tests/channel-config-db.test.mjs`: deterministic fake-client tests for queries, rollback, audit, and idempotency.
- Create `scripts/configure-channels.mjs`: CLI argument parsing, file loading, terminal confirmation, output, exit codes, and `pg.Client` lifecycle.
- Create `tests/configure-channels-cli.test.mjs`: CLI orchestration tests with injected dependencies.
- Modify `vitest.config.ts`: include `.test.mjs` files.
- Modify `.gitignore`: ignore local channel configuration JSON while allowing the example.
- Create `channel-config.example.json`: placeholder-only version-1 configuration.
- Create `docs/channel-setup.md`: operator runbook, safety model, recovery, and examples.
- Modify `README.md`: link the channel setup runbook.
- Modify `package.json`: add a discoverable `channels:configure` script.

---

### Task 1: Shared encryption-key and target-crypto compatibility

**Files:**
- Create: `lib/notifications/target-crypto-core.mjs`
- Create: `lib/notifications/target-crypto-core.d.mts`
- Modify: `lib/notifications/target-crypto.ts`
- Create: `tests/target-crypto.test.ts`

**Interfaces:**
- Produces: `parseEncryptionKey(value: string): Buffer`
- Produces: `encryptTargetCore(plaintext: string, encryptionKey: string): string`
- Produces: `decryptTargetCore(payload: string, encryptionKey: string): string`
- Produces: `maskTargetCore(channel: string, target: string): string`
- Preserves: existing app exports `encryptTarget`, `decryptTarget`, and `maskTarget` from `lib/notifications/target-crypto.ts`.

- [ ] **Step 1: Write failing raw/base64 compatibility tests**

Create `tests/target-crypto.test.ts` with `vi.mock("server-only", () => ({}))` before dynamically importing the server wrapper. Test these exact cases:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const crypto = await import("@/lib/notifications/target-crypto");

describe("target encryption keys", () => {
  const raw = "0123456789abcdef0123456789abcdef";
  const base64 = Buffer.from(raw, "utf8").toString("base64");

  it.each([raw, base64])("round-trips with a supported key representation", (key) => {
    const encrypted = crypto.encryptTarget("https://discord.com/api/webhooks/1/secret", key);
    expect(encrypted.split(":"), "iv:tag:ciphertext").toHaveLength(3);
    expect(crypto.decryptTarget(encrypted, key)).toBe("https://discord.com/api/webhooks/1/secret");
  });

  it("rejects values that are neither raw nor base64 32-byte keys", () => {
    expect(() => crypto.encryptTarget("target", "short-key")).toThrow(
      "APP_ENCRYPTION_KEY must be exactly 32 bytes as raw text or base64",
    );
  });

  it("preserves masking behavior", () => {
    expect(crypto.maskTarget("email", "operator@example.com")).toBe("o***@example.com");
    expect(crypto.maskTarget("whatsapp", "+8801712345678")).toBe("+88***78");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the base64 case fails**

Run:

```powershell
npm test -- --run tests/target-crypto.test.ts
```

Expected: raw key passes; base64 key fails because the current helper measures the base64 text rather than decoded bytes.

- [ ] **Step 3: Implement the runtime-neutral crypto core**

Create `lib/notifications/target-crypto-core.mjs` using `node:crypto` only. `parseEncryptionKey` must:

1. reject empty input;
2. return raw UTF-8 bytes when `Buffer.byteLength(value, "utf8") === 32`;
3. otherwise decode strict base64, requiring canonical round-trip after removing trailing `=` padding and exactly 32 decoded bytes;
4. throw `APP_ENCRYPTION_KEY must be exactly 32 bytes as raw text or base64` for every invalid value.

Move the existing AES-256-GCM and masking implementations into exports named `encryptTargetCore`, `decryptTargetCore`, and `maskTargetCore`. Preserve the payload order `iv`, authentication tag, ciphertext, joined with `:`.

Create `lib/notifications/target-crypto-core.d.mts`:

```ts
export function parseEncryptionKey(value: string): Buffer;
export function encryptTargetCore(plaintext: string, encryptionKey: string): string;
export function decryptTargetCore(payload: string, encryptionKey: string): string;
export function maskTargetCore(channel: string, target: string): string;
```

- [ ] **Step 4: Preserve the server-only TypeScript wrapper**

Replace the implementation in `lib/notifications/target-crypto.ts` with `import "server-only"` plus named aliases from the core:

```ts
import "server-only";
import {
  decryptTargetCore,
  encryptTargetCore,
  maskTargetCore,
} from "@/lib/notifications/target-crypto-core.mjs";

export const encryptTarget = encryptTargetCore;
export const decryptTarget = decryptTargetCore;
export const maskTarget = maskTargetCore;
```

- [ ] **Step 5: Run focused and existing notification tests**

Run:

```powershell
npm test -- --run tests/target-crypto.test.ts tests/channels.test.ts tests/engine.test.ts tests/notifications.test.ts
npm run typecheck
npm run lint
```

Expected: all selected tests pass; typecheck and lint exit 0.

- [ ] **Step 6: Review checkpoint**

Review only the four Task 1 files. Confirm old raw-key ciphertext still decrypts, base64 keys work, malformed base64 is rejected, and the app remains the only importer of the server-only wrapper.

---

### Task 2: Pure configuration validation and redacted change planning

**Files:**
- Create: `scripts/lib/channel-config.mjs`
- Create: `tests/channel-config.test.mjs`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `encryptTargetCore`, `decryptTargetCore`, `maskTargetCore` from Task 1.
- Produces: `parseChannelConfig(raw: unknown): ChannelConfig`
- Produces: `validateEnvironment(config, env): EnvironmentContext`
- Produces: `buildChangePlan(config, snapshot, env): ChangePlan`
- Produces: `formatRedactedPreview(plan): string`
- Produces: `sanitizeError(error): string`
- The `snapshot` shape contains `actor`, providers, provider contacts, and optional provider settings loaded by Task 3.
- The `ChangePlan` contains normalized contact inserts/updates, complete settings upserts, masked before/after summaries, and no plaintext Discord target outside an internal non-enumerable/private operation field.

- [ ] **Step 1: Include `.mjs` tests in Vitest**

Modify `vitest.config.ts`:

```ts
include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
```

Run `npm test -- --run tests/channel-config.test.mjs` and confirm Vitest reports no matching test file before it is created.

- [ ] **Step 2: Write failing strict-schema and environment tests**

Create `tests/channel-config.test.mjs`. Import pure functions from `scripts/lib/channel-config.mjs`. Use a valid fixture with version 1, project ref, admin actor, one NTT recipient, enabled email/WhatsApp, and disabled Discord.

Test:

- valid config parses;
- unknown top-level, provider, contact, channel, or target fields fail;
- duplicate provider codes and duplicate contact keys fail;
- `projectRef` must match `NEXT_PUBLIC_SUPABASE_URL` and the tenant in `DATABASE_URL` when present;
- provider Discord requires a 32-byte raw/base64 app key;
- global Discord requires `DISCORD_WEBHOOK_URL`;
- errors mention field/provider/contact key but never include secret input values.

Use assertions such as:

```js
expect(() => parseChannelConfig({ ...valid, unexpected: true })).toThrow(/unexpected/i);
expect(() => validateEnvironment(valid, mismatchedEnv)).toThrow(/projectRef/);
expect(sanitizeError(new Error(`bad ${secret}`))).not.toContain(secret);
```

- [ ] **Step 3: Run schema tests and confirm missing-module failure**

Run:

```powershell
npm test -- --run tests/channel-config.test.mjs
```

Expected: FAIL because `scripts/lib/channel-config.mjs` does not exist.

- [ ] **Step 4: Implement strict version-1 schema and environment validation**

Create `scripts/lib/channel-config.mjs` using Zod `.strict()` objects and these exact enums/fields:

- contact type: `internal_owner | provider_account_manager | recipient | other`;
- contact keys: lowercase-safe identifiers matching `^[a-z0-9][a-z0-9_-]{0,63}$`;
- phone: `^\+[1-9][0-9]{7,14}$`;
- Discord mention ID: digits only;
- Discord target discriminated union: `{source:"global"}` or `{source:"provider",webhookUrl:https URL}`.

Normalize provider codes to uppercase, emails to lowercase, phone numbers unchanged after trim, and timestamps to ISO strings. Implement explicit duplicate checks after parsing. Implement environment project-ref extraction from `https://<ref>.supabase.co` and `postgres.<ref>`.

- [ ] **Step 5: Write failing cross-field validation and matching tests**

Extend `tests/channel-config.test.mjs` to cover:

- enabled email requires a non-empty `to` list;
- every email recipient key resolves to an active contact with email;
- WhatsApp recipients require active contact, phone, opt-in timestamp, and source;
- disabled channels may have empty routes but reject contradictory targets;
- HTTPS Discord URL only; digit-only mentions; duplicates removed without reordering;
- matching precedence: explicit ID, email, phone;
- email and phone resolving to different rows is rejected;
- duplicate existing email/phone identities are rejected;
- unspecified existing contacts are absent from operations;
- changed contacts become updates, new contacts become inserts, unchanged contacts produce no contact operation;
- settings are complete desired state;
- reapplying unchanged state yields no semantic settings change, including provider Discord where decrypted target identity matches despite randomized ciphertext.

- [ ] **Step 6: Implement desired-state planning and matching**

Implement `buildChangePlan` as a pure function. The snapshot contract is:

```js
{
  actor: { id, email, role, active },
  providers: [{
    id, code, name,
    contacts: [{ id, contact_type, name, role_title, email, phone_e164,
      whatsapp_opt_in_at, whatsapp_opt_in_source, active }],
    settings: null | { email_enabled, whatsapp_enabled, discord_enabled,
      email_to, email_cc, email_bcc, reply_to, subject_prefix,
      email_template_override, whatsapp_template_name,
      whatsapp_recipient_ids, discord_webhook_ciphertext,
      discord_mention_ids }
  }]
}
```

Require actor role `admin` and `active === true`. Require every configured provider to resolve exactly once. Match contacts using ID, normalized email, then phone, rejecting conflicts/ambiguity. Keep unspecified contacts untouched. Convert channel contact keys to planned contact references and settings fields. Compare provider Discord by decrypting current ciphertext when present; never compare random ciphertext bytes.

- [ ] **Step 7: Write failing preview/redaction tests**

Test that the preview includes provider code, insert/update counts, channel state, recipient counts, masked email/phone, and Discord state (`configured`, `changed`, `removed`) while excluding:

- full email;
- full E.164 number;
- BCC identities;
- plaintext webhook;
- ciphertext;
- app encryption key;
- database URL/password;
- global webhook URL.

- [ ] **Step 8: Implement preview formatting and safe errors**

Implement `formatRedactedPreview(plan)` with deterministic provider/contact ordering. Use `maskTargetCore` for email/WhatsApp. Show BCC count only. For Discord show state only. Implement `sanitizeError` using known config/environment sensitive values collected during validation; replace exact sensitive substrings and URL userinfo with `[REDACTED]`.

- [ ] **Step 9: Run pure tests and static checks**

Run:

```powershell
npm test -- --run tests/channel-config.test.mjs tests/target-crypto.test.ts
npm run typecheck
npm run lint
```

Expected: all pass with no live database calls.

- [ ] **Step 10: Review checkpoint**

Review pure behavior only. Confirm the module has no `pg` import, dry planning cannot write, unknown JSON fields fail, and no preview/error path exposes protected values.

---

### Task 3: PostgreSQL preflight and atomic apply

**Files:**
- Create: `scripts/lib/channel-config-db.mjs`
- Create: `tests/channel-config-db.test.mjs`

**Interfaces:**
- Consumes: `parseChannelConfig`, `validateEnvironment`, and `buildChangePlan` from Task 2.
- Produces: `loadSnapshot(client, config): Promise<Snapshot>`
- Produces: `runDryRun(client, config, env): Promise<ChangePlan>`
- Produces: `applyChangePlan(client, config, env): Promise<ChangePlan>`
- Database client contract: `connect()`, `query(text, params?)`, and `end()` are supplied by CLI; this module never reads files or prompts.

- [ ] **Step 1: Write a deterministic fake PostgreSQL client**

In `tests/channel-config-db.test.mjs`, define `FakeClient` that records `{text, params}`, returns queued outcomes, and can throw at a named query marker. Do not mock the `pg` package and do not use live credentials.

Provide fixture outcomes for:

- active admin lookup by case-insensitive email;
- provider lookup by uppercase code;
- contacts for selected provider IDs;
- settings for selected provider IDs;
- contact insert/update `returning` rows;
- settings upsert;
- `append_audit_log` call.

- [ ] **Step 2: Write failing read-only dry-run tests**

Test that `runDryRun` executes, in order:

```sql
begin transaction read only
-- actor/provider/contact/settings reads
rollback
```

Assert no query contains `insert`, `update`, `delete`, or `append_audit_log`; plan output is returned after rollback. Test missing actor, inactive/non-admin actor, missing provider, and duplicate provider lookup failures.

- [ ] **Step 3: Run DB tests and confirm missing-module failure**

Run:

```powershell
npm test -- --run tests/channel-config-db.test.mjs
```

Expected: FAIL because `scripts/lib/channel-config-db.mjs` does not exist.

- [ ] **Step 4: Implement snapshot loading and read-only dry run**

Create `scripts/lib/channel-config-db.mjs`. Use parameterized queries only. `loadSnapshot` must query exactly the selected actor email and provider codes, then selected provider IDs for contacts/settings. `runDryRun` must begin a read-only transaction, load/build the plan, and always roll back in `finally`; if rollback fails, preserve the original error and append a safe rollback message.

- [ ] **Step 5: Write failing atomic apply and rollback tests**

Cover:

- `begin`, re-read with `for update`, operations, audit, `commit` order;
- exact contact ID ownership enforcement;
- insert uses `returning id` and later settings use returned UUIDs;
- update changes only specified contact fields;
- no operation for unchanged contacts;
- one settings upsert per changed provider;
- provider Discord plaintext is encrypted immediately before settings upsert;
- unchanged provider Discord creates no semantic change;
- any provider/contact/settings/audit failure issues one `rollback`, no `commit`;
- a two-provider failure on provider 2 rolls back provider 1 operations;
- changed providers call `public.append_audit_log` with action `provider.channels.configure`, entity type `provider`, and redacted summaries only;
- unchanged plans do not write settings or audit entries.

- [ ] **Step 6: Implement atomic apply**

Implement `applyChangePlan`:

1. `begin`;
2. load actor/providers/contacts/settings with `for update` and rebuild the plan inside the transaction;
3. execute contact inserts/updates in provider/code/key order;
4. resolve all planned contact keys to UUIDs;
5. encrypt provider Discord URL in memory using `encryptTargetCore`, then drop the plaintext reference;
6. upsert settings with all version-1 desired fields using `on conflict (provider_id) do update`;
7. call `select public.append_audit_log($1::uuid,$2,$3,$4::uuid,$5::jsonb,$6::jsonb,$7)` for each changed provider;
8. `commit`;
9. on any error, `rollback` and throw a sanitized error.

The audit JSON must contain channel booleans, masked/aggregate routes, contact insert/update counts, and Discord configured state only. Generate a request ID such as `channel-config:<UTC ISO timestamp>:<provider code>` without recipient data.

- [ ] **Step 7: Run database-adapter tests**

Run:

```powershell
npm test -- --run tests/channel-config-db.test.mjs tests/channel-config.test.mjs
npm run lint
```

Expected: all pass; tests contain no live project URL, secret key, or database password.

- [ ] **Step 8: Review checkpoint**

Review SQL parameterization, lock/recheck behavior, rollback paths, no-op behavior, contact preservation, and audit redaction. Confirm no query interpolates user-provided values.

---

### Task 4: Interactive CLI, example configuration, and operator runbook

**Files:**
- Create: `scripts/configure-channels.mjs`
- Create: `tests/configure-channels-cli.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `channel-config.example.json`
- Create: `docs/channel-setup.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 2 parsing/preview functions and Task 3 dry-run/apply functions.
- Produces CLI: `node --env-file=.env.local scripts/configure-channels.mjs <config.json> [--apply]`.
- Produces package command: `npm run channels:configure -- <config.json> [--apply]`.
- Exit codes: 0 success; 1 validation/database/encryption/transaction failure; 2 usage/missing argument/invalid flag/non-interactive apply; 3 confirmation rejection/cancel.

- [ ] **Step 1: Write failing CLI orchestration tests**

Create `tests/configure-channels-cli.test.mjs`. Export `runCli({argv, env, stdin, stdout, stderr, dependencies})` from the future CLI so tests inject file reads, prompt responses, DB factory, dry-run/apply functions, and output capture.

Test:

- missing file or unknown flag exits 2 and never constructs DB client;
- default invocation calls dry run only and exits 0;
- `--apply` on non-TTY exits 2 without writes;
- mismatch confirmation exits 3 without `applyChangePlan`;
- exact project confirmation calls apply once and exits 0;
- validation/database errors exit 1 with sanitized output;
- output includes redacted preview but no fixture secret values;
- client `end()` runs after success and failure.

- [ ] **Step 2: Run CLI tests and confirm missing-module failure**

Run:

```powershell
npm test -- --run tests/configure-channels-cli.test.mjs
```

Expected: FAIL because the CLI module does not exist.

- [ ] **Step 3: Implement CLI parsing and confirmation**

Create `scripts/configure-channels.mjs` with:

- exact usage text;
- one required `.json` path and optional `--apply` only;
- `readFile` + `JSON.parse` with sanitized path/error reporting;
- `pg.Client({connectionString: env.DATABASE_URL, ssl:{rejectUnauthorized:false}})`;
- dry-run preview before any prompt;
- `readline/promises` prompt requiring exact `config.projectRef`;
- TTY check before prompt;
- dependency-injected `runCli` for tests;
- top-level execution guard comparing `import.meta.url` to `pathToFileURL(process.argv[1]).href`;
- exit-code assignment without `process.exit()` inside `runCli`.

- [ ] **Step 4: Add package script and ignored example policy**

Modify `package.json` scripts:

```json
"channels:configure": "node scripts/configure-channels.mjs"
```

Append to `.gitignore`:

```gitignore
channel-config*.json
!channel-config.example.json
```

Create `channel-config.example.json` matching spec version 1, using only reserved/example domains, fake E.164 numbers, disabled channels by default, and no webhook URL. Ensure dry run can parse it but may fail provider lookup safely.

- [ ] **Step 5: Write the operator runbook**

Create `docs/channel-setup.md` covering:

1. prerequisites: approved providers/channels, `.env.local`, active admin, database pooler;
2. copy `channel-config.example.json` to `channel-config.local.json`;
3. field reference for contacts and all three channels;
4. WhatsApp opt-in evidence requirements;
5. provider vs global Discord target behavior;
6. dry-run and apply commands;
7. exact confirmation behavior and exit-code table;
8. how masking/redaction works;
9. atomic rollback and safe retry;
10. how to disable a channel without deleting contacts;
11. channel test remains separate at Settings → Channel test;
12. never commit local config or paste tokens/webhooks into chat/issues/logs.

Modify README §6 to link `docs/channel-setup.md` and mention the dry-run command.

- [ ] **Step 6: Run CLI and documentation checks**

Run:

```powershell
npm test -- --run tests/configure-channels-cli.test.mjs tests/channel-config-db.test.mjs tests/channel-config.test.mjs tests/target-crypto.test.ts
npm run channels:configure -- channel-config.example.json
git check-ignore -v channel-config.local.json
git check-ignore -v channel-config.example.json
```

Expected:

- focused tests pass;
- example command parses and exits safely without writes (provider placeholder validation may produce exit 1);
- local config is ignored;
- example config is not ignored because of the exception rule.

- [ ] **Step 7: Run full repository verification**

Run:

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: all commands exit 0; existing 63 tests plus new operator tests pass.

- [ ] **Step 8: Perform a manual dry-run safety check**

Copy the example to a temporary ignored file, replace only `projectRef` and `actorEmail` with the real local values, keep every channel disabled, then run without `--apply`:

```powershell
Copy-Item channel-config.example.json channel-config.local.json
node --env-file=.env.local scripts/configure-channels.mjs channel-config.local.json
```

Before and after, query counts for `provider_contacts`, `provider_notification_settings`, and `audit_logs`. Expected: all counts unchanged and output contains no full credentials/recipients. Remove the temporary local config after the check.

- [ ] **Step 9: Final review checkpoint**

Review all Task 4 files plus the final diff. Confirm help text matches docs, the example contains no real values, apply cannot bypass confirmation, local config is ignored, all verification evidence is recorded, and no live channel send occurred.

---

## Plan Self-Review

- **Spec coverage:** Task 1 covers shared raw/base64 crypto compatibility. Task 2 covers strict JSON, cross-field validation, matching, desired-state planning, redacted preview, and safe errors. Task 3 covers active-admin/provider preflight, read-only dry run, atomic apply, encryption, audit, rollback, and idempotency. Task 4 covers interactive confirmation, exit codes, ignored local files, example, documentation, and complete verification.
- **Placeholder scan:** No TBD/TODO/“implement later” instructions. Example placeholder values are deliberate reserved-domain fixtures and are explicitly required to fail safely against real provider lookup.
- **Type/interface consistency:** Task 2 owns `ChannelConfig`, `Snapshot`, and `ChangePlan`; Task 3 consumes those exact shapes; Task 4 injects and invokes Task 2/3 functions. Crypto function names remain consistent between declaration, wrapper, CLI, and tests.
- **Safety consistency:** Every write path requires `--apply`, TTY, exact project confirmation, active admin, transactional recheck, parameterized SQL, and audit. Dry run always rolls back and cannot execute write SQL.
- **Scope consistency:** Browser UI, contact deletion, CI apply bypass, automatic credential enabling, and live sends remain out of scope.
