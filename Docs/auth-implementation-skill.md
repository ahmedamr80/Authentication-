# Skill: Professional Authentication & Authorization Implementation

**Purpose:** Rebuild or audit a webapp's sign-up, sign-in, and authorization system to a
production-grade standard, compliant with OAuth 2.0/OIDC best practices and Apple App
Store requirements.

**Rule for the executing AI/engineer:** Do not proceed to the next step until the
"Verification" checklist for the current step passes. If a check fails, fix the issue,
re-run the verification, and only then advance. Treat this as a gated pipeline, not a
checklist to skim.

---

## STEP 0 — Discovery & Gap Audit

**Action:**
1. Inventory the current auth system: how passwords are hashed, how sessions/tokens are
   issued, where tokens are stored client-side, what login methods exist (password only?
   social?), and whether MFA exists.
2. Identify the stack (framework, DB, whether it's a SPA + API, or server-rendered app,
   whether an iOS app consumes the same backend).
3. List every gap against the target architecture in Steps 1–11 below.

**Verification (must pass before continuing):**
- [ ] You have a written list of current password hashing algorithm, token type, token
      storage location, and session lifetime.
- [ ] You know whether an iOS/Apple client exists or is planned (this determines whether
      Section 8, Apple compliance, is mandatory or optional).
- [ ] You have identified whether this is a SPA (needs PKCE) or a traditional
      server-rendered app (can use server-side sessions).

**Do not proceed until this audit is documented.** Guessing at the current state causes
half-migrated, inconsistent auth systems.

---

## STEP 1 — Password Storage Foundation

**Action:**
1. Replace any existing hashing (MD5, SHA-1, plain SHA-256, or plaintext) with
   **Argon2id** (preferred) or **bcrypt** with a cost factor that takes ~250–500ms on
   your production hardware (starting floor of 12, re-benchmarked yearly as hardware
   improves — don't treat 12 as a permanent constant).
2. Do not implement composition rules ("must contain a symbol"). Instead enforce a
   minimum length (10–12 characters) and check submitted passwords against a breached-password
   list (e.g., HaveIBeenPwned's k-anonymity API) at signup and password-change time.
3. Write a one-time migration: on next successful login with the old hash scheme,
   re-hash the password with the new algorithm and update the stored hash.

**Verification:**
- [ ] New signups produce Argon2id/bcrypt hashes — confirm by inspecting a fresh DB
      record's hash prefix (`$argon2id$` or `$2b$`).
- [ ] Attempting a password shorter than your minimum is rejected server-side (not just
      client-side — test by calling the API directly, bypassing the frontend).
- [ ] A password known to be in a breach list (e.g., "Password123!") is rejected at
      signup.
- [ ] Existing users can still log in, and their hash is upgraded on next login (check
      DB before/after one test login).

**Do not proceed to Step 2 until all four checks pass.**

---

## STEP 2 — Sign-Up Flow (Email/Password Path)

**Action:**
1. Collect only email + password at initial signup. Defer other profile fields to
   post-registration.
2. On submission, check if the email exists. **Never** return "email already taken."
   Instead: if it doesn't exist, create the account as `is_email_verified = false`; if
   it does exist, silently send a "reset your password" email and show the identical
   generic message ("Check your inbox to continue") in both cases.
3. Generate a cryptographically random 256-bit verification token. Store only its
   SHA-256 hash server-side with a 15–30 minute expiry. Email the raw token as a link:
   `https://yourapp.com/verify-email?token=...`.
4. Rate-limit the signup endpoint by IP and by email address. Add CAPTCHA (hCaptcha or
   Cloudflare Turnstile) after repeated attempts from the same IP.
5. Until verified, restrict the account to a read-only or limited state — no payments,
   no sensitive data changes.

**Verification:**
- [ ] Submitting an existing email returns the exact same response/timing as a new
      email (test with a timer or diff the raw HTTP responses).
- [ ] The verification email token expires after the configured window (test by waiting
      or manipulating server clock in staging).
- [ ] A verification link can only be used once (second use fails).
- [ ] Signup attempts beyond your rate limit threshold (e.g., 10/min from one IP) are
      blocked or CAPTCHA-gated.
- [ ] An unverified account cannot perform a restricted action (test directly against
      the API).

**Do not proceed to Step 3 until all five checks pass.**

---

## STEP 3 — Social Sign-In via OIDC + PKCE (Google, Sign in with Apple, etc.)

**Action:**
1. On the frontend, before redirecting to the provider, generate a `code_verifier`
   (random string) and derive a `code_challenge` (SHA-256 of the verifier, base64url
   encoded). Generate a random `state` (CSRF protection) and `nonce` (replay
   protection). Store `code_verifier` and `state` in short-lived session storage.
2. Redirect to the provider's `/authorize` endpoint with `client_id`, `redirect_uri`,
   `response_type=code`, `scope=openid email name`, `state`, `nonce`, and
   `code_challenge` (+ `code_challenge_method=S256`).
3. On callback, verify the returned `state` matches what you stored. Exchange the
   `authorization_code` **server-to-server** for tokens, sending the original
   `code_verifier` so the provider can validate the PKCE challenge.
4. Validate the returned `id_token` JWT: signature against the provider's live JWKS,
   `iss`, `aud`, `exp`, and `nonce` match.
5. Provision the user record using the provider's `sub` claim as the durable unique
   identifier — never the email alone (emails can be reassigned or hidden via relay).
6. **Apple-specific:** Apple sends the user's name **only on the very first
   authorization**. Capture and persist it then; it will not be resent on subsequent
   logins. Treat any `@privaterelay.appleid.com` address as a fully legitimate primary
   email — never prompt the user to provide a "real" one.

**Verification:**
- [ ] A callback request with a mismatched or missing `state` is rejected.
- [ ] A callback request with a tampered `id_token` signature is rejected.
- [ ] Logging in with the same Apple/Google account twice does not create duplicate
      user records (test by logging in twice with one test account).
- [ ] A test Apple Sign-In captures the name on first login, and a second login without
      a name in the payload does not null out the previously stored name.
- [ ] A private-relay email address completes signup without any extra prompt.

**Do not proceed to Step 4 until all five checks pass.**

---

## STEP 4 — Sign-In Flow (Password Path) + Brute-Force Protection

**Action:**
1. Accept credentials only over HTTPS/TLS 1.2+. Enforce HSTS.
2. Compare the password hash using the algorithm's built-in constant-time verify
   function (never a manual `==` comparison of hashes).
3. Return a single generic error for both "no such user" and "wrong password":
   `Invalid email or password.`
4. Implement escalating protection: CAPTCHA after 3 failed attempts, exponential
   backoff or temporary lockout after 5, per-account **and** per-IP tracking.
5. Log every failed attempt (account, IP, timestamp) for anomaly monitoring (see Step
   10).

**Verification:**
- [ ] A wrong password and a nonexistent email produce byte-identical error responses.
- [ ] After 5 rapid failed attempts on one account, the 6th attempt is blocked or
      CAPTCHA-gated, even from a different IP.
- [ ] A distributed attempt (many accounts, one IP) also triggers protection.
- [ ] Failed-attempt logs are queryable (confirm a test failure appears in logs).

**Do not proceed to Step 5 until all four checks pass.**

---

## STEP 5 — Multi-Factor Authentication (MFA)

**Action:**
1. Offer, in order of preference: **WebAuthn/passkeys** (phishing-resistant, strongly
   preferred) → **TOTP** authenticator app → **SMS OTP** (weakest, offer only as a
   fallback for accessibility, never as the sole option for high-value accounts).
2. Require MFA enrollment prompt after first successful login (not blocking, but
   strongly encouraged), and mandatory for admin/privileged roles.
3. Gate full-scope access token issuance on MFA completion when enabled — a user who
   passes password check but fails MFA gets no valid session.
4. Provide backup/recovery codes at MFA enrollment, single-use, stored hashed.

**Verification:**
- [ ] A user with MFA enabled cannot obtain a valid access token from password alone
      (test by stopping after password step and probing a protected endpoint).
- [ ] A WebAuthn/passkey registration and login round-trip succeeds in a test browser.
- [ ] A used backup code is rejected on second use.
- [ ] Admin/privileged test accounts cannot bypass MFA enrollment.

**Do not proceed to Step 6 until all four checks pass.**

---

## STEP 6 — Token Issuance & Client-Side Storage Architecture

**Action:**
1. On successful authentication (+ MFA if applicable), issue two tokens:
   - **Access token**: JWT, 5–15 minute expiry, contains `sub`, `roles`/`permissions`,
     `iat`, `exp`, `aud`, `iss`.
   - **Refresh token**: opaque or JWT, 7–30 day expiry.
2. Client-side storage:
   - Access token → kept **only in memory** (JS variable/app state) — never
     localStorage, never a readable cookie.
   - Refresh token → `HttpOnly`, `Secure`, `SameSite=Strict` cookie, inaccessible to
     JavaScript.
3. Access token sent via `Authorization: Bearer <token>` header on each API call.
   Refresh token is sent automatically by the browser only to the refresh endpoint.

**Verification:**
- [ ] `document.cookie` in the browser console does not reveal the refresh token.
- [ ] Inspecting client-side JS state/storage (localStorage, sessionStorage) shows no
      refresh token; access token, if visible at all, disappears on tab reload
      (confirming in-memory-only storage).
- [ ] An API call without the `Authorization` header is rejected.
- [ ] An expired access token (wait past its TTL or force-expire in staging) is
      rejected by the resource server.

**Do not proceed to Step 7 until all four checks pass.**

---

## STEP 7 — Silent Refresh, Rotation & Reuse Detection

**Action:**
1. On a 401 from an expired access token, the frontend automatically calls
   `/api/auth/refresh` (refresh cookie sent automatically by the browser).
2. Backend validates the refresh token, then **invalidates it** and issues a brand-new
   access token + brand-new refresh token (rotation on every use). Set the new cookie.
3. **Reuse detection:** if a refresh token that was already invalidated/used is
   submitted again, treat this as a signal of token theft — immediately revoke the
   entire session family (all tokens issued in that lineage) and force re-login.
4. Cap absolute session lifetime (e.g., 30 days) regardless of how often refresh
   happens — don't allow indefinite sliding renewal.

**Verification:**
- [ ] After a refresh call, the old refresh token is rejected if replayed.
- [ ] Replaying an old (already-rotated) refresh token revokes the whole session — a
      subsequent legitimate refresh attempt with the *newest* token also fails,
      confirming full-family revocation.
- [ ] A session older than your absolute cap is forced to re-authenticate even with
      valid, actively-rotating refresh tokens.

**Do not proceed to Step 8 until all three checks pass.**

---

## STEP 8 — Authorization (RBAC/ABAC) & API Enforcement

**Action:**
1. Encode coarse role claims (`role: admin`) in the access token JWT for fast checks.
2. For anything ownership- or context-dependent (e.g., "can this user edit this
   specific resource"), enforce with server-side ABAC logic at the API/middleware
   layer — never trust a client-supplied role or ID without re-checking against the DB.
3. Resource servers validate JWTs locally via the auth server's JWKS public key (no DB
   hit needed for signature/claims validation on every request).
4. Require **step-up authentication** (re-enter password or MFA) for sensitive actions
   (payment methods, email/password change, account deletion) even mid-session.

**Verification:**
- [ ] A user assigned role "user" cannot access an admin-only endpoint, even with a
      manually crafted request.
- [ ] User A cannot modify a resource owned by User B, even by directly editing the
      resource ID in the request (test this explicitly — it's the most common real-world
      break).
- [ ] Changing the email/password requires re-authentication in the same test session,
      even though the access token is still valid.

**Do not proceed to Step 9 until all three checks pass.**

---

## STEP 9 — Logout & Token Revocation

**Action:**
1. On logout: clear the refresh token cookie (`Max-Age=0`), and add the current access
   token's `jti` (JWT ID) to a short-lived revocation list (e.g., Redis, TTL = token's
   remaining lifetime only — never longer, to keep this list small and avoid
   undermining the statelessness benefit of JWTs).
2. Provide a "sign out of all devices" action: revoke every refresh token and access
   token `jti` associated with the user's session set.
3. If the user has a linked Apple/Google account and deletes it, call the provider's
   token revocation endpoint too.

**Verification:**
- [ ] An access token used immediately after logout is rejected (checked against the
      revocation list).
- [ ] "Sign out of all devices" invalidates sessions on a second test device/browser.
- [ ] Revocation list entries expire and are removed once the token's natural TTL
      passes (confirm it doesn't grow unbounded).

**Do not proceed to Step 10 until all three checks pass.**

---

## STEP 10 — Monitoring & User-Facing Security Signals

**Action:**
1. Log all auth events (login success/failure, MFA challenge, password change, new
   device, logout) without ever logging raw passwords or full tokens.
2. On login from a new device/browser/location, email the user: "New sign-in from
   [device/location] — wasn't you? [secure this account link]."
3. Alert internally on anomalous patterns: geo-velocity impossible travel, distributed
   credential-stuffing signatures, spikes in failed attempts.

**Verification:**
- [ ] A login from a new browser (clear cookies/use incognito) triggers the
      new-device email.
- [ ] Auth logs contain no plaintext passwords or full raw tokens (grep your log
      output to confirm).
- [ ] A simulated spike in failed logins across many accounts from one IP surfaces in
      your monitoring/alerting within your target window.

**Do not proceed to Step 11 until all three checks pass.**

---

## STEP 11 — Apple App Store Compliance (mandatory if an iOS client exists)

**Action:**
1. If you offer **any** third-party login (Google, Facebook, etc.), add **Sign in with
   Apple** as an equally prominent option — same size and near-equal visual ranking,
   not buried below other buttons.
2. Support in-app **account deletion** (not just deactivation) — this must fully
   revoke tokens and remove/anonymize personal data, initiated entirely inside the app,
   not only via a support ticket.
3. Don't force sign-in at first launch unless your core feature genuinely requires it —
   allow browsing/exploration first where feasible (deferred sign-in).
4. If you do any cross-app/cross-site tracking, request permission via
   `ATTrackingManager` (App Tracking Transparency) — separate from the login
   requirement.
5. Use Apple's `LocalAuthentication` framework for Face ID/Touch ID — do not build a
   custom biometric prompt UI.

**Verification:**
- [ ] Sign in with Apple button matches the size/prominence of other social login
      buttons in a screenshot comparison.
- [ ] Deleting a test account in-app removes the ability to log back in with that
      account's credentials, and a fresh signup with the same email is possible
      afterward (confirming real deletion, not soft-deactivation).
- [ ] The app allows some exploration before any forced login wall (unless your core
      feature truly requires auth immediately — document why if so).
- [ ] ATT prompt appears before any tracking SDK fires, if tracking is used.

**Do not submit to App Store review until all four checks pass.**

---

## STEP 12 — Final Pre-Launch Security Pass

**Action:** Run through this consolidated checklist once, end to end, as a final gate.

- [ ] TLS enforced everywhere, HSTS header present.
- [ ] Argon2id/bcrypt hashing confirmed on live signups.
- [ ] Enumeration-safe responses on signup, login, and password reset.
- [ ] PKCE + state + nonce validated on every social login round-trip.
- [ ] Access token in memory only; refresh token in HttpOnly/Secure/SameSite cookie.
- [ ] Refresh rotation + reuse detection confirmed working (Step 7 tests re-verified).
- [ ] RBAC/ABAC ownership checks confirmed (Step 8's resource-ID test re-verified).
- [ ] Logout revokes tokens immediately; sign-out-all-devices works.
- [ ] New-device email notifications firing.
- [ ] Apple compliance items complete (if applicable).

**Only consider the auth system production-ready once every box on this final list is
checked against a live (staging) environment test — not just code review.**
