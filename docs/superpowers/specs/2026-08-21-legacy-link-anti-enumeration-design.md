# Legacy Magic-Link Anti-Enumeration Design

## Goal

Make the existing `?method=link` login path return the same public success state for unknown emails as it does for eligible passwordless accounts.

## Scope

Only `requestMagicLink` changes. The existing email validation, PKCE callback configuration, rate-limit handling, generic provider-error handling, UI, and compatibility URL remain unchanged.

## Behavior

After `signInWithOtp`:

| Provider result | Redirect |
|---|---|
| No error | `/login?notice=link-sent` |
| `otp_disabled` | `/login?notice=link-sent` |
| Rate limit | `/login?error=rate-limited` |
| Any other provider error | `/login?error=service-unavailable` |

Invalid input remains `/login?error=invalid-input`, and unexpected thrown errors remain `/login?error=service-unavailable` unless they are rate-limit-shaped.

## Security and Compatibility

- Unknown and passwordless email submissions through both the email-first and legacy link flows expose the same success redirect.
- Provider details are never reflected.
- Existing redirects and error copy remain byte-for-byte unchanged except for the newly handled `otp_disabled` case.
- No dependencies, migrations, or UI changes are required.

## Testing and Verification

- Add a failing action test proving `otp_disabled` maps to `link-sent`.
- Retain coverage proving generic provider errors remain `service-unavailable` and rate limits remain `rate-limited`.
- Run the focused action tests, full Vitest suite, and `npm run typecheck`.
- Push to `master`, wait for Vercel deployment, then exercise the deployed `/login?method=link` flow with an unknown email and confirm the success redirect/banner and absence of browser console errors.
