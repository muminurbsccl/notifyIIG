# Legacy Link Anti-Enumeration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the legacy `requestMagicLink` action map GoTrue's `otp_disabled` response to the existing link-sent success state without changing other behavior.

**Architecture:** Add one explicit `otp_disabled` branch to the existing provider-error redirect ternary in `app/login/actions.ts`. Lock the behavior with action tests, preserve rate-limit and generic-error branches, then verify locally and against the deployed Vercel application.

**Tech Stack:** Next.js server actions, TypeScript, Supabase Auth, Vitest, Vercel.

## Global Constraints

- Unknown and passwordless emails must expose the same `/login?notice=link-sent` redirect.
- Rate limits must remain `/login?error=rate-limited`.
- Non-rate-limit provider errors must remain `/login?error=service-unavailable`.
- Invalid input must remain `/login?error=invalid-input`.
- Do not add dependencies, migrations, or UI changes.
- Do not reflect provider error details.

---

### Task 1: Add regression coverage and implement legacy mapping

**Files:**
- Modify: `tests/login-actions.test.ts` near the existing `requestMagicLink` provider-error tests.
- Modify: `app/login/actions.ts:35-60`.

**Interfaces:**
- Consumes: existing `requestMagicLink(formData: FormData): Promise<void>` and `isRateLimited(error: unknown)`.
- Produces: `otp_disabled` redirects to `/login?notice=link-sent`; all existing branches retain their current redirect strings.

- [ ] **Step 1: Write the failing test**

Add this test after the generic provider-error test:

```ts
it("maps an unknown-email otp_disabled response to the link-sent state", async () => {
  mocks.signInWithOtp.mockResolvedValue({
    data: {},
    error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" },
  });

  await expectRedirect(
    requestMagicLink(formData({ email: "unknown@example.com" })),
    "/login?notice=link-sent",
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run tests/login-actions.test.ts -t "unknown-email otp_disabled"
```

Expected: FAIL because `requestMagicLink` currently redirects this provider error to `/login?error=service-unavailable`.

- [ ] **Step 3: Implement the minimal branch**

Change only the provider-error branch in `requestMagicLink` to mirror `beginSignIn`:

```ts
destination = error
  ? isRateLimited(error)
    ? "/login?error=rate-limited"
    : error.code === "otp_disabled"
      ? "/login?notice=link-sent"
      : serviceErrorDestination("")
  : "/login?notice=link-sent";
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/login-actions.test.ts
```

Expected: all action tests pass, including invalid-input, rate-limit, generic provider-error, and both email-first anti-enumeration tests.

- [ ] **Step 5: Commit the implementation**

```bash
git add app/login/actions.ts tests/login-actions.test.ts
git commit -m "fix(auth): hide unknown emails in legacy magic-link flow"
```

### Task 2: Full verification, deploy, and live smoke test

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: committed Task 1 implementation and existing Vercel deployment from `master`.
- Produces: verified local test results, pushed commit, and live anti-enumeration evidence.

- [ ] **Step 1: Run the complete local verification suite**

Run:

```bash
npx vitest run
npm run typecheck
```

Expected: all tests pass and TypeScript reports no errors.

- [ ] **Step 2: Inspect status and push**

Run:

```bash
git status --short
git push origin master
```

Expected: only intended commits are present and `master` is pushed successfully.

- [ ] **Step 3: Wait for Vercel and verify the deployed page**

Poll `https://notifyiig.vercel.app/login?method=link` until it returns HTTP 200. Use the existing Chrome CDP smoke-test pattern to submit an unknown email and verify:

```text
URL ends with /login?notice=link-sent
Banner says: If the account is eligible, a sign-in link is on its way. Check your inbox.
No Runtime.exceptionThrown or error-level console entries
```

- [ ] **Step 4: Final review**

Run:

```bash
git status --short
git log --oneline -3
```

Expected: clean working tree, pushed fix commit at `HEAD`, and no deployment or verification risks unresolved.
