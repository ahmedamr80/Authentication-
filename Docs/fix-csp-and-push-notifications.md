# Fix Plan: CSP Dev-Mode Hydration Issue & Push Notification VAPID Key Error

**Rule for the executing AI tool:** Do not proceed to the next step until the
"Verification" checklist for the current step passes. If a check fails, fix the issue,
re-run the verification, and only then advance.

**Context:** A prior fix disabled the entire Content-Security-Policy (and other security
headers) in development to unblock Turbopack hydration. This is a shortcut, not a fix —
it means dev no longer tests the same security posture as production, so a future CSP
break (e.g., a new script source, new API host) won't be caught until it's live. This
plan replaces that shortcut with a scoped fix. It also diagnoses a separate,
**unaddressed** bug: an `InvalidAccessError` on `PushManager.subscribe` caused by an
invalid `applicationServerKey` (VAPID key). This was not touched by the previous fix and
needs its own root-cause pass.

---

## STEP 1 — Diagnose the Real CSP Blocker (don't guess, confirm)

**Action:**
1. Temporarily re-enable the full production CSP in dev (revert the
   `NODE_ENV === "development"` bypass).
2. Open the browser dev tools Console and Network tab, reload the app, and capture the
   **exact** CSP violation error(s) — they name the blocked directive and source
   (e.g., `Refused to connect to 'ws://localhost:3000/_next/webpack-hmr' because it
   violates the following Content Security Policy directive: "connect-src 'self'"`).
3. List every distinct violation. Expect at least: `connect-src` blocking the Turbopack
   HMR WebSocket, and possibly `script-src` blocking `eval`-based dev bundling.

**Verification:**
- [ ] You have the literal browser console CSP violation messages, not an assumption
      about what's blocked.
- [ ] Each violation is mapped to a specific directive (`script-src`, `connect-src`,
      etc.) and a specific blocked resource/origin.

**Do not proceed to Step 2 until you have the actual violation list.**

---

## STEP 2 — Apply Scoped Dev-Only CSP Exceptions (not a full bypass)

**Action:**
1. In `next.config.mjs` (or wherever the CSP header is built), keep the **same base
   policy** for both dev and prod. Add only the specific, minimal exceptions Step 1's
   violations require, gated by `NODE_ENV === "development"`. Typical minimal set for
   Turbopack/webpack dev mode:
   ```js
   const isDev = process.env.NODE_ENV === "development";

   const scriptSrc = `'self'${isDev ? " 'unsafe-eval'" : ""}`;
   const connectSrc = `'self' https://*.googleapis.com https://*.firebaseio.com${
     isDev ? " ws://localhost:* http://localhost:*" : ""
   }`;

   const csp = [
     `default-src 'self'`,
     `script-src ${scriptSrc}`,
     `connect-src ${connectSrc}`,
     // keep every other directive (style-src, img-src, frame-src for Google/Apple
     // sign-in popups, font-src, etc.) IDENTICAL between dev and prod
   ].join('; ');
   ```
2. Do **not** remove or skip the header wholesale in dev. Every directive that isn't
   specifically named in Step 1's violation list stays exactly as it is in production.
3. Keep all other security headers (HSTS, X-Frame-Options, X-Content-Type-Options,
   Referrer-Policy, Permissions-Policy) fully active in dev — none of those were
   implicated in the hydration bug, so none of them should be touched.

**Verification:**
- [ ] Reload the app in dev. `onAuthStateChanged` fires and the app hydrates past
      "Loading..." without any CSP violation in the console.
- [ ] Diff the dev CSP against the prod CSP — the only differences present are the
      exact exceptions identified in Step 1 (e.g., `'unsafe-eval'` in `script-src`,
      localhost WebSocket in `connect-src`). No directive was dropped entirely.
- [ ] HSTS, X-Frame-Options, and the other non-CSP headers are still present in dev
      (check via Network tab → response headers on any page load).

**Do not proceed to Step 3 until all three checks pass.**

---

## STEP 3 — Verify the Production CSP Still Works End-to-End

**Action:**
1. Run a real production build locally: `next build && next start` (not `next dev`).
2. With the production build running, exercise the full sign-in surface: email/password
   sign-in, Google sign-in popup, Apple sign-in popup, and at least one authenticated
   Firestore read/write.
3. Watch the console for any CSP violation during this pass — this is the first time
   the *actual* production policy is being exercised against real auth flows, since all
   prior testing happened either in dev (with CSP off) or against unit-level function
   calls.

**Verification:**
- [ ] Email/password sign-in completes with zero CSP violations in console.
- [ ] Google sign-in popup opens and completes with zero CSP violations (checks
      `frame-src`/`script-src` allow Google's auth domains).
- [ ] Apple sign-in popup opens and completes with zero CSP violations (checks
      `frame-src`/`script-src` allow Apple's auth domains).
- [ ] An authenticated Firestore read and write both succeed with zero CSP violations
      (checks `connect-src` allows `firestore.googleapis.com` or equivalent).

**Do not proceed to Step 4 until all four checks pass. This step is the one that
actually proves production isn't broken — everything before it was dev-only.**

---

## STEP 4 — Audit the `firebase/messaging` Dynamic Import for Race Conditions

**Action:**
1. Confirm every call site that previously did
   `import { getMessaging, isSupported } from "firebase/messaging"` now does
   `const { getMessaging, isSupported } = await import("firebase/messaging")`.
2. Find every feature that depends on messaging being ready (e.g., push notification
   registration triggered right after login, or on dashboard mount). Confirm there is
   an explicit loading/ready state guarding use of `getMessaging`/`getToken` — the code
   must not assume the dynamic import has resolved just because the component rendered.
3. Add a simple guard pattern if missing:
   ```ts
   const [messaging, setMessaging] = useState<Messaging | null>(null);

   useEffect(() => {
     let cancelled = false;
     (async () => {
       const { getMessaging, isSupported } = await import("firebase/messaging");
       if (!(await isSupported())) return;
       const app = getFirebaseApp();
       if (!cancelled) setMessaging(getMessaging(app));
     })();
     return () => { cancelled = true; };
   }, []);
   ```
   Any button/action that triggers push registration should be disabled or no-op until
   `messaging` is non-null.

**Verification:**
- [ ] No remaining static top-level `import ... from "firebase/messaging"` anywhere in
      the codebase (grep confirms zero matches).
- [ ] The "Enable notifications" action (or equivalent) is disabled/inert until the
      dynamic import has resolved — confirmed by clicking it immediately on page load,
      before the async import would realistically have finished, and observing no crash
      or undefined-reference error.

**Do not proceed to Step 5 until both checks pass.**

---

## STEP 5 — Add the `/auth/login` → `/auth/signin` Redirect

**Action:**
1. Add a redirect (in `next.config.mjs` `redirects()`, or a route handler) from
   `/auth/login` to `/auth/signin`, permanent (308) or temporary (307) depending on
   whether the URL might ever legitimately differ later — use 307 unless you're certain
   it's permanent.

**Verification:**
- [ ] Visiting `/auth/login` directly in a browser now lands on `/auth/signin` instead
      of a 404.

**Do not proceed to Step 6 until this check passes.**

---

## STEP 6 — Diagnose the VAPID Key `InvalidAccessError` (separate, unfixed bug)

**This error was not addressed by the previous CSP/SSR fix and needs its own root-cause
pass. Do not assume it's resolved.**

**Action:**
1. Check whether `NEXT_PUBLIC_FIREBASE_VAPID_KEY` is actually defined at runtime in the
   browser: temporarily `console.log(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY)` right
   before the `getToken` call and reload. In Next.js, `NEXT_PUBLIC_*` vars are inlined
   at **build time** — if this env var was added to `.env.local` *after* the last
   build/dev-server start, it will be `undefined` until the server is restarted (or
   rebuilt for production). This is the most common cause of this exact error.
2. If the variable is defined, verify it's the **correct** key: Firebase Console →
   Project Settings → Cloud Messaging → "Web configuration" → **Web Push certificates**
   → the public "Key pair" string. This is *not* the same as any Server key, API key, or
   App ID — using the wrong credential from the same console page produces this exact
   `InvalidAccessError`, since the browser Push API rejects a malformed/mismatched
   `applicationServerKey`.
3. Check for copy-paste corruption: no surrounding quotes, no trailing whitespace or
   newline, no truncation. The key should be a single unbroken base64url string.
4. Confirm the key belongs to the **same Firebase project** as the rest of the app's
   config (`firebaseConfig.projectId`) — a VAPID key from a different/old project will
   also fail validation.
5. Once corrected, restart the dev server (or rebuild) so the `NEXT_PUBLIC_*` value is
   actually picked up.

**Verification:**
- [ ] `console.log(process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY)` in the browser prints
      the expected non-empty string (then remove the log statement).
- [ ] The value matches, character-for-character, the "Key pair" string shown under
      Cloud Messaging → Web Push certificates in Firebase Console for the correct
      project.
- [ ] Clicking "Enable notifications" no longer throws `InvalidAccessError` in the
      console.

**Do not proceed to Step 7 until all three checks pass.**

---

## STEP 7 — Verify Push Notification Subscription End-to-End

**Action:**
1. In a real browser (not just dev tools simulation), grant notification permission
   when prompted and complete the subscribe flow.
2. Confirm `getToken()` resolves with a real FCM registration token (log it once, then
   remove the log).
3. Send a test push from Firebase Console → Cloud Messaging → "Send test message",
   pasting in the token from step 2.
4. Confirm the notification is received by the browser/device.

**Verification:**
- [ ] `getToken()` returns a non-empty token string with no thrown error.
- [ ] A test message sent from Firebase Console is received and displayed.
- [ ] Re-running the subscribe flow after already being subscribed doesn't throw or
      duplicate-register (should return the cached token, not error).

**Do not proceed to Step 8 until all three checks pass.**

---

## STEP 8 — Final Regression Pass

**Action:** Re-run this consolidated list once, end to end, in the production build
(`next build && next start`), not dev.

- [ ] Dashboard loads correctly when logged in.
- [ ] Sign-in page renders with Google/Apple/Email options, all three complete
      successfully with zero CSP violations.
- [ ] Root `/` redirects correctly to `/dashboard` or `/auth/signin` based on auth
      state.
- [ ] `/auth/login` redirects to `/auth/signin` instead of 404.
- [ ] No console errors on any page, in the production build specifically (not just
      dev).
- [ ] Push notification opt-in completes without `InvalidAccessError` and a test
      message is successfully received.
- [ ] Dev-mode CSP is a scoped superset of prod CSP (Step 2's diff still holds) — not
      disabled.

**Only consider this closed once every item is checked against the production build —
not the dev server with relaxed security headers.**
