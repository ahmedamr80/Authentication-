# Product Requirements Document

## Executive Summary
**EveryWherePadel (EWP)** (hosted at `ewpuae.com`, application ID `com.ewpuae.app`) is a digital community and event management platform tailored for the padel sports ecosystem in the United Arab Emirates (UAE). The platform provides end-to-end matchmaking, court and venue discovery, event participation management (solo players and doubles teams), real-time notifications, and administrative back-office controls. The system is built as a Progressive Web App (PWA) using Next.js 16 (App Router), React 19, Tailwind CSS 4, and Firebase services (Firebase Authentication, Cloud Firestore, Cloud Storage, Cloud Messaging, and Cloud Functions v2), wrapped via Capacitor for native mobile distribution on iOS and Android.

- *Source: `package.json`, `capacitor.config.ts`, `README.md`, `src/app/layout.tsx`, `Docs/app_architecture_report.md`*

---

## Problem Statement & Product Vision
Organizing recreational and competitive padel sports requires coordinating player schedules, booking club courts, finding compatible doubles partners, managing waiting lists, and communicating schedule changes. Traditional manual coordination (via messaging groups or spreadsheets) creates fragmented communications, uncoordinated withdrawals, double-bookings, and unverified participation.

EveryWherePadel provides a unified platform where:
1. Players discover upcoming padel events, evaluate entry requirements, register solo or as pairs, manage personal match schedules, and communicate with partners.
2. Admins create venues (clubs), configure events with dynamic capacity limits and pricing, manage user directories (including synthetic shadow profiles), audit system activity, and orchestrate automated cleanup and registration counts.

- *Source: `README.md`, `src/app/dashboard/page.tsx`, `src/app/events/page.tsx`, `src/app/admin/data-manager/page.tsx`, `scenarios.json`*

---

## Target Users & User Roles

Role-based access control and system actors are extracted directly from RBAC definitions, middleware, route guards, and Firestore security rules:

### 1. Player (`role: "player"`)
- **Description:** Standard end-user registered on the platform.
- **Capabilities:** Browse public events and partner clubs; register as a solo player or doubles team; invite registered or unregistered partners; withdraw from confirmed or waitlisted events; maintain player profile (hand preference, court position, skill level, bio, avatar); view personal schedule; manage notifications; install PWA.
- **Permissions:** `events:read`, `events:register_self`, `profile:read_self`, `profile:write_self`, `teams:manage_self`.
- *Source: `src/lib/auth/rbac-abac.ts#L12-L18`, `firestore.rules#L24-L46`, `src/app/player/page.tsx`*

### 2. Administrator (`role: "admin"`, `isAdmin: true`)
- **Description:** Platform operator with unrestricted administrative control.
- **Capabilities:** Create, edit, and cancel events; create partner clubs and upload club photography; access back-office Data Manager (`/admin/data-manager`); perform batch updates and bulk deletions across all 6 main Firestore collections (`users`, `events`, `registrations`, `clubs`, `teams`, `notifications`); create shadow player profiles; trigger manual event cleanup (`manualEventCleanup`) and count reconciliation (`recalculateEventCounts`); manage media storage library; view security audit logs (`auth_audit_logs`).
- **Permissions:** Wildcard `*` (fulfills all role and permission requirements).
- *Source: `src/lib/auth/rbac-abac.ts#L4`, `firestore.rules#L10-L17`, `src/app/admin/data-manager/page.tsx`, `src/app/events/create/page.tsx`, `src/app/clubs/create/page.tsx`*

### 3. Auditor (`role: "auditor"`)
- **Description:** Read-only compliance and monitoring role.
- **Capabilities:** Inspect system logs, user rosters, events, registrations, and teams without modification rights.
- **Permissions:** `logs:read`, `users:read`, `events:read`, `registrations:read`, `teams:read`.
- *Source: `src/lib/auth/rbac-abac.ts#L5-L11`*

### 4. General User (`role: "user"`)
- **Description:** Equivalent base privileges to `player`.
- **Permissions:** `events:read`, `events:register_self`, `profile:read_self`, `profile:write_self`, `teams:manage_self`.
- *Source: `src/lib/auth/rbac-abac.ts#L19-L26`*

### 5. Shadow Player (`isShadow: true`)
- **Description:** A synthetic user placeholder created by an administrator in Firestore to represent an offline or unregistered player in matches and teams.
- **Rules:** Has no Firebase Auth account initially; when a real player signs up using the shadow player's email, the shadow record is claimed, historical registrations are inherited, and the temporary document is deleted.
- *Source: `collections.json#L12`, `src/app/api/auth/signup/route.ts#L92-L109`, `firestore.rules#L44-L45`*

---

## Core System Workflows (Trigger, Preconditions, Steps, Edge Cases)

### Workflow 1: User Registration & Email Verification
- **Trigger:** User submits the sign-up form at `/auth/signin` (Sign Up tab).
- **Preconditions:** Valid email format; password minimum 12 characters; passwords match.
- **Step-by-Step Logic:**
  1. Client validates inputs against Zod schema (`authSchema`).
  2. Request sent to `POST /api/auth/signup`.
  3. Server checks sliding-window rate limit (max 5 requests per minute per IP and email).
  4. Server performs HaveIBeenPwned k-Anonymity breach check (SHA-1 prefix range API).
  5. Checks if account exists in Firebase Auth (`adminAuth.getUserByEmail`) or Firestore (`users` collection).
  6. Creates user in Firebase Auth (`adminAuth.createUser`).
  7. If existing shadow record exists (`isShadow: true`) matching email: claims shadow record, copies profile attributes to new UID, marks `isShadow: false`, and deletes old shadow document. Otherwise, creates fresh `users/{uid}` document with `role: "player"`, `isAdmin: false`.
  8. Generates cryptographically secure 256-bit email verification token (stored in `verification_tokens` as SHA-256 hash with 24-hour TTL).
  9. Logs verification link URL to console (`/auth/verify-email?token=...`).
- **Edge Cases:**
  - *Password found in breach:* Rejected with HTTP 400 (`"This password has appeared in a data breach..."`).
  - *Email already registered:* Rejected with HTTP 409 (`auth/email-already-in-use`).
  - *Token already used or expired:* `POST /api/auth/verify-email` rejects with HTTP 400.
- *Source: `src/app/auth/signin/page.tsx#L49-L89`, `src/app/api/auth/signup/route.ts`, `src/lib/auth/password-security.ts`, `src/lib/auth/verification-token.ts`, `src/app/api/auth/verify-email/route.ts`*

---

### Workflow 2: Authentication, Brute-Force Defense & MFA
- **Trigger:** User submits sign-in credentials at `/auth/signin`.
- **Preconditions:** User exists; account not locked.
- **Step-by-Step Logic:**
  1. Client sends email and password to `POST /api/auth/signin`.
  2. Server checks brute-force state:
     - 3 failed attempts: requires CAPTCHA token (`requireCaptcha: true`).
     - 5 failed attempts: triggers 15-minute account lockout (`lockedOut: true`, HTTP 429).
  3. Authenticates credentials against Firebase Auth Identity Toolkit REST API.
  4. On failure: increments failure count in memory and Firestore (`brute_force_attempts`), logs `LOGIN_FAILED` audit event, injects artificial delay to prevent timing attacks.
  5. On success: resets failed attempts count, checks if MFA is enabled (`mfa_enabled: true`).
  6. *If MFA enabled:* issues a 5-minute ephemeral `pendingMfaToken` and halts full login until TOTP code or backup code is submitted to `POST /api/auth/mfa/verify`.
  7. *If MFA disabled:* creates session family (`refresh_token_families`), issues 15-minute HS256 JWT access token (in response payload) and 7-day refresh token in HttpOnly `__Host-refreshtoken` cookie.
- **Edge Cases:**
  - *Token Reuse (Replay Attack):* If a previously rotated refresh token JTI is submitted to `/api/auth/refresh`, the entire session family is instantly revoked across all devices, logging `LOCKOUT_TRIGGERED`.
  - *Absolute Session Timeout:* Reaching 30 days from initial login revokes the session family, requiring fresh credentials.
- *Source: `src/app/api/auth/signin/route.ts`, `src/lib/auth/brute-force.ts`, `src/lib/auth/session-family.ts`, `src/lib/auth/tokens.ts`, `src/app/api/auth/mfa/verify/route.ts`*

---

### Workflow 3: Social Authentication (Google & Apple)
- **Trigger:** User clicks "Continue with Google" or "Continue with Apple" at `/auth/signin`.
- **Preconditions:** Client completes popup or native OAuth authorization.
- **Step-by-Step Logic:**
  1. Client retrieves OIDC credential (`idToken`, provider user profile).
  2. Client submits payload to `POST /api/auth/oauth/callback`.
  3. Validates PKCE `state` parameter if stored.
  4. Validates OIDC ID token claims (signature, issuer, expiration, audience).
  5. Looks up user by durable identity `federatedId` (`apple:<sub}>` or `google:<sub>`).
  6. **First-Time Name Preservation:** If user already exists, updates name *only* if provided name is non-empty and stored name is blank. Never overwrites existing name with null on subsequent logins.
  7. If new user: provisions new `users/{uid}` record in Firestore with verified status.
- **Edge Cases:**
  - *Apple Private Relay:* User hides email address (`@privaterelay.appleid.com`); platform matches on Apple `sub` claim to prevent orphaned accounts.
- *Source: `src/app/auth/signin/page.tsx#L240-L380`, `src/app/api/auth/oauth/callback/route.ts`, `src/lib/auth/apple-auth.ts`, `src/lib/auth/pkce-oidc.ts`*

---

### Workflow 4: Event Creation & Auto-Incrementing ID
- **Trigger:** Admin clicks "Save Event" on `/events/create`.
- **Preconditions:** Caller is authenticated and verified as Admin (`isAdmin == true`); required fields provided (name, venue, start date/time, duration, slots, unit type).
- **Step-by-Step Logic:**
  1. Form validates required fields, numeric price, slots, and coordinates.
  2. Executes Firestore transaction (`runTransaction`):
     - Reads `counters/events` document.
     - Increments `lastIndex = lastIndex + 1`.
     - Generates 3-digit zero-padded ID: `EVENT` + `String(newIndex).padStart(3, '0')` (e.g. `EVENT024`).
     - Writes event document to `events/{eventId}` with `status: "Upcoming"`, `registrationsCount: 0`, `waitlistCount: 0`.
     - Commits counter update.
  3. Uploads event logo to Firebase Storage (`events/{timestamp}_{filename}`) if attached.
  4. Redirects admin to `/events`.
- **Edge Cases:**
  - *Concurrent creations:* Firestore transaction guarantees unique, sequential event IDs without collisions.
- *Source: `src/app/events/create/page.tsx#L200-L265`, `collections.json#L34-L55`, `collections.json#L133-L139`*

---

### Workflow 5: Player Registration & Eligibility Verification
- **Trigger:** Player clicks "Register Solo" or "Register as Team" on `/events/[eventId]`.
- **Preconditions:** Player authenticated; event is `Upcoming` and `isPublic: true`.
- **Step-by-Step Logic:**
  1. Client executes `checkPlayerEligibility(user, cachedProfile)`.
  2. Verifies `user.emailVerified == true` (unless `EMAIL_VERIFICATION_ON == "off"`).
  3. Verifies `user.phone` is present in Firestore and has length $\ge 8$ characters.
  4. If either check fails: blocks registration and displays `EligibilityGateDialog`.
  5. If eligible:
     - For Players mode: checks available slots against `registrations.filter(status == 'CONFIRMED')`.
     - If slots available: creates registration document with `status: "CONFIRMED"`.
     - If event full: creates registration document with `status: "WAITLIST"`, calculates `waitlistPosition`.
     - Increments event `registrationsCount` or `waitlistCount` accordingly.
- **Edge Cases:**
  - *Unverified email:* Modal directs user to send verification email.
  - *Missing phone:* Modal prompts user to input phone number directly into profile.
- *Source: `src/app/events/[eventId]/page.tsx#L86-L107`, `src/lib/authRequirements.ts`, `src/components/EligibilityGateDialog.tsx`, `src/components/RegisterDialog.tsx`*

---

### Workflow 6: Doubles Team Invitations, Responses & Dissolution (Scenarios 1–15)
The platform features an exhaustive doubles matchmaking state machine verified against `scenarios.json`:
- **Scenario 1 (Unregistered Partner Declines):** Player 1 (P1) registers and invites P2 (unregistered). P2 declines. Team document is deleted; P1 survives as a free agent (`lookingForPartner: true`, status `CONFIRMED`); event counts remain unchanged; P1 notified.
- **Scenario 2 (Free Agent Partner Declines):** PX invites existing registered free agent PY. PY declines. Team deleted; both PX and PY remain confirmed free agents (`lookingForPartner: true`).
- **Scenario 3 (Captain Withdraws Before Response):** P1 withdraws while team status is `PENDING`. Team and registration documents are deleted; P2 receives cancellation notification.
- **Scenario 4 (Captain Cancels Invite):** P1 cancels invite before P2 responds. Team deleted; P1 survives as confirmed free agent (`partnerStatus: "None"`); P2 notified.
- **Scenario 5 (Confirmed Team: Captain Leaves):** Confirmed team formed; P1 leaves. P1 registration deleted; P2 survives and transitions to free agent (`lookingForPartner: true`); team deleted; slot remains occupied by P2 (no promotion).
- **Scenario 6 (Confirmed Team: Partner Leaves):** Confirmed team formed; P2 leaves. P2 registration deleted; P1 survives as free agent (`lookingForPartner: true`); slot remains occupied.
- **Scenario 7 (Confirmed Team Dissolution / Both Leave):** Both players withdraw from confirmed team. Both registrations deleted; slot opens up; longest-waiting waitlist team promoted to `CONFIRMED` and notified; if no waitlist, event `registrationsCount` decrements by 1.
- **Scenario 14 (Solo Player Mode Withdrawal):** Confirmed player leaves. Player status set to `CANCELLED`; if waitlist exists: oldest waitlisted player promoted to `CONFIRMED`, `waitlistCount` decremented, notification dispatched; if no waitlist: `registrationsCount` decremented.
- **Scenario 15 (Waitlist Withdrawal):** Waitlisted player or team withdraws; `waitlistCount` decremented; no slot opened.
- *Source: `scenarios.json`, `src/hooks/useTeamInvite.ts`, `src/hooks/useTeamAccept.ts`, `src/hooks/useTeamDissolve.ts`, `src/hooks/useEventWithdraw.ts`*

---

### Workflow 7: Account Deletion (GDPR & Apple Compliance)
- **Trigger:** User confirms account deletion in `/player` settings dialog.
- **Preconditions:** User enters current account password (step-up verification) and types confirmation phrase `"DELETE MY ACCOUNT"`.
- **Step-by-Step Logic:**
  1. Client sends request to `POST /api/auth/delete-account`.
  2. Server executes step-up re-authentication verifying password against Firebase Auth REST API.
  3. Validates exact string match on confirmation phrase.
  4. If user registered via Apple and has `apple_refresh_token`: calls Apple token revocation API (`https://appleid.apple.com/auth/revoke`) satisfying Apple App Store Guideline 5.1.1(v).
  5. Revokes all active session families in Firestore (`refresh_token_families`).
  6. Deletes user document `users/{uid}` and recursively wipes subcollections.
  7. Deletes Firebase Auth user record (`adminAuth.deleteUser`).
  8. Writes `ACCOUNT_DELETED` security audit log entry.
  9. Clears HttpOnly refresh token cookie.
- **Edge Cases:**
  - *Incorrect password:* Step-up authentication fails with HTTP 401.
  - *Mismatched phrase:* Rejected with HTTP 400.
- *Source: `src/app/api/auth/delete-account/route.ts`, `src/lib/auth/account-deletion.ts`, `src/lib/auth/step-up.ts`*

---

## Functional Requirements (Inputs, Outputs, Validations, Permissions)

### 1. Authentication & Security API

| Endpoint | Method | Inputs | Outputs | Validations & Constraints | Required Permission / Role | Evidence (File Paths) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/signup` | POST | `email`, `password`, `fullName` | `{ success, message }` | Min 12 chars; HaveIBeenPwned breach check; 5 req/min rate limit | Public | `src/app/api/auth/signup/route.ts` |
| `/api/auth/signin` | POST | `email`, `password`, `captchaToken` | `{ success, accessToken, customToken, requireCaptcha, lockedOut }` | 3 fails = CAPTCHA, 5 fails = 15 min lock; timing attack mitigation | Public | `src/app/api/auth/signin/route.ts` |
| `/api/auth/refresh` | POST/GET | Cookie: `__Host-refreshtoken` | `{ success, accessToken, message }` | JWT signature valid; family not revoked; absolute 30-day session cap | Public (Cookie auth) | `src/app/api/auth/refresh/route.ts` |
| `/api/auth/logout` | POST | Bearer token, Refresh Cookie | `{ success, message }` | Revokes access token JTI in Firestore; revokes session family | Authenticated user | `src/app/api/auth/logout/route.ts` |
| `/api/auth/logout-all` | POST | Bearer token | `{ success, revokedSessionsCount }` | Revokes all session families associated with caller UID | Authenticated user | `src/app/api/auth/logout-all/route.ts` |
| `/api/auth/delete-account` | POST | `stepUpPassword`, `confirmPhrase` | `{ success, appleRevoked, message }` | Step-up re-auth; phrase must equal "DELETE MY ACCOUNT" | Authenticated user | `src/app/api/auth/delete-account/route.ts` |
| `/api/auth/oauth/callback` | POST | `provider`, `idToken`, `userPayload`, `state` | `{ success, uid, isNewUser }` | Provider must be `apple` or `google`; OIDC token signature verified | Public | `src/app/api/auth/oauth/callback/route.ts` |
| `/api/auth/mfa/enroll` | POST | `uid`, `action` ("init"/"confirm"), `code` | `{ success, secret, otpauthUrl, rawBackupCodes }` | RFC 6238 TOTP; returns 8 single-use backup codes once | Authenticated user | `src/app/api/auth/mfa/enroll/route.ts` |
| `/api/auth/mfa/verify` | POST | `pendingToken`, `code`, `isBackupCode` | `{ success, accessToken, customToken }` | 5-min pending token TTL; clock skew $\pm 1$ window; backup code consumed | Public (pending token) | `src/app/api/auth/mfa/verify/route.ts` |
| `/api/auth/validate-password` | POST | `password` | `{ valid, error }` | Minimum 12 chars; HaveIBeenPwned range API | Public | `src/app/api/auth/validate-password/route.ts` |
| `/api/auth/verify-email` | POST/GET | `token` | `{ success, message }` | Token must exist in `verification_tokens`, unexpired, single-use | Public | `src/app/api/auth/verify-email/route.ts` |

### 2. User & Admin Management API

| Endpoint | Method | Inputs | Outputs | Validations & Constraints | Required Permission / Role | Evidence (File Paths) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/users/change-password` | POST | `currentPassword`, `newPassword` | `{ success, message }` | Step-up re-auth; new password validates security policy | Authenticated user | `src/app/api/users/change-password/route.ts` |
| `/api/users/update-profile` | POST | `targetUid`, `fullName` | `{ success, message }` | ABAC check: requester must be resource owner or admin | Resource Owner or Admin | `src/app/api/users/update-profile/route.ts` |
| `/api/users/upload-photo` | POST | FormData: `file`, `targetUid` | `{ success, photoUrl }` | `image/*` MIME type only; max 5MB; owner or admin | Resource Owner or Admin | `src/app/api/users/upload-photo/route.ts` |
| `/api/upload` | POST | FormData: `file`, `folder`, `customId` | `{ success, url }` | Max 5MB; image MIME; `clubs`, `events`, `media` require admin | Admin for shared folders | `src/app/api/upload/route.ts` |
| `/api/admin/users` | POST | None | `{ success, requester, role }` | Role check via `withRole("admin")` | `admin` | `src/app/api/admin/users/route.ts` |
| `/api/list-users` | GET | Query: `limit`, `nextPageToken` | `{ users, pageToken }` | Header `Authorization: Bearer ADMIN_API_KEY` | Admin API Key | `src/app/api/list-users/route.ts` |
| `/api/events/withdraw` | POST | `eventId`, `targetUid` (optional) | `{ success, updatedCount }` | Caller must be participant or admin; sets status to CANCELLED | Participant or Admin | `src/app/api/events/withdraw/route.ts` |

---

## Explicit Business Rules & Constraints

1. **Password Complexity & Breach Protection:** Minimum 12 characters (`MIN_PASSWORD_LENGTH = 12`). Must pass k-Anonymity SHA-1 prefix check against HaveIBeenPwned API (`https://api.pwnedpasswords.com/range/{prefix}`).
   - *Source: `src/lib/auth/password-security.ts#L3-L80`*
2. **Brute-Force Lockout Policy:**
   - $\ge 3$ failed login attempts $\rightarrow$ triggers mandatory CAPTCHA challenge.
   - $\ge 5$ failed login attempts $\rightarrow$ triggers strict 15-minute lockout (`LOCKOUT_DURATION_MS = 15 * 60 * 1000`).
   - Slotted sliding window: 15 minutes (`WINDOW_DURATION_MS = 15 * 60 * 1000`).
   - Dual tracking: tracks attempts by both client IP address and target email.
   - *Source: `src/lib/auth/brute-force.ts#L19-L23`*
3. **Session Token Expirations & Token Family Rules:**
   - Access Token TTL: Exactly 15 minutes (900 seconds).
   - Refresh Token TTL: Exactly 7 days (604,800 seconds).
   - Absolute Session Cap: Hard maximum of 30 days (`ABSOLUTE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000`).
   - Token Replay Detection: Using any previously consumed JTI in a family revokes the entire family and terminates active sessions on all devices.
   - *Source: `src/lib/auth/tokens.ts#L42-L43`, `src/lib/auth/session-family.ts#L15`*
4. **Email Verification Requirement:**
   - Registration check enforced via `EMAIL_VERIFICATION_ON = "on"`.
   - Players cannot register for events unless their email is verified and phone number has $\ge 8$ digits.
   - Verification token TTL: 24 hours (`VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000`).
   - *Source: `src/lib/authRequirements.ts#L5-L82`, `src/lib/auth/verification-token.ts#L3`*
5. **Event Status Transition Engine:**
   - Calculated dynamically on client and automated weekly in Cloud Functions:
     - `Active`: Current time is between `dateTime` and `dateTime + duration`.
     - `Upcoming`: Current time is before `dateTime`.
     - `Past`: Current time is after `dateTime + duration` or marked by cleanup scheduler.
     - `Cancelled`: Event has `cancellationMessage` or `status == "Cancelled"`.
   - *Source: `src/app/events/page.tsx#L46-L56`, `functions/src/updateEventStatus.ts#L15-L59`*
6. **Storage File Restrictions:**
   - Maximum upload size: 5 Megabytes (`5 * 1024 * 1024`).
   - MIME types: Must match `image/*`.
   - Permissions: Only admins can write to `events/`, `clubs/`, and `media/`. Users can write only to `profile-pictures/{userId}` or `user-uploads/{userId}`.
   - *Source: `storage.rules#L23-L77`, `src/app/api/upload/route.ts#L58-L70`*
7. **Cross-Origin & CSRF Protections:**
   - Mutating HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`) to `/api/*` reject requests whose `Origin` header does not match the request `Host` (unless local development).
   - *Source: `src/middleware.ts#L8-L33`*

---

## Navigation Structure & Screen Inventory

### Navigation Architecture
- **Primary Header (`src/components/layout/Header.tsx`):** Fixed top navigation displaying logo, back button (when enabled), notification bell with unread badge counter, and user profile avatar dropdown (Settings, Profile, Sign Out).
- **Bottom Navigation Bar (`src/components/layout/BottomNav.tsx`):** Fixed bottom navigation on mobile with 3 primary tabs:
  1. `Home` (`/dashboard`)
  2. `Events` (`/events`)
  3. `Community` (`/community`)

### Screen Inventory

| Screen Name | Route | Core Components | User Actions | Displayed Data | Empty / Error States | Evidence (File Paths) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Root Entry** | `/` | Loading spinner, redirect logic | Automatic redirect based on auth | Logo, "Loading Padel Manager..." | Fallback timeout redirects to `/auth/signin` after 3s | `src/app/page.tsx` |
| **Authentication** | `/auth/signin` | `SignInContent`, Dialogs, Zod Form | Sign in, Sign up, Google OAuth, Apple OAuth, Password Reset, Remember Me | Email/Password fields, Remember Me switch, Auth mode tabs | Input validation tooltips, toast error messages, lockout warning | `src/app/auth/signin/page.tsx` |
| **Verify Email** | `/auth/verify-email` | Token verifier card, Status banner | Submits token, links back to sign-in | Status badge, success/failure instructions | Invalid, expired, or already used token banners | `src/app/auth/verify-email/page.tsx` |
| **Dashboard** | `/dashboard` | `Header`, `BottomNav`, Menu cards, Install prompts | Navigate to features, enable push notifications, install PWA | 7 navigation cards with unread notification badge | Conditional prompt dismissals | `src/app/dashboard/page.tsx` |
| **Events Feed** | `/events` | `EventFilters`, `EventSection`, `EventCard` | Search, filter (All, Active, Upcoming, Past, Cancelled), infinite scroll | Event cards with dates, venues, price, spot counters, badge | Skeleton loaders; "No events found" empty state | `src/app/events/page.tsx` |
| **Event Details** | `/events/[eventId]` | `Header`, `Tabs`, `TeamsList`, `SinglePlayersList`, `AddToCalendarButton`, `EventTermsSection` | View rosters, Register Solo, Register Team, Withdraw, Invite Partner, Share | Start time, venue, duration, price, spot counters, confirmed/waitlist rosters | "Event not found" error screen with return button | `src/app/events/[eventId]/page.tsx` |
| **Create Event** | `/events/create` | `Card`, Form fields, Image picker, Switch | Set event parameters, upload banner, save via transaction | Name, club picker, date, duration, pricing, unit type | Admin protection redirect; inline field errors | `src/app/events/create/page.tsx` |
| **Edit Event** | `/events/[eventId]/edit` | Admin form, Delete dialog, Cancel dialog | Update event parameters, cancel event with reason, delete event | Pre-populated event form fields | Protected route; 404 on missing event ID | `src/app/events/[eventId]/edit/page.tsx` |
| **Community** | `/community` | `CommunityFilters`, `SortControls`, `PlayerCard` | Search players, filter by hand/skill/position/gender, view player | Player avatar, skill badge, hand, position, member since date | Skeleton cards; "No players found matching your criteria" | `src/app/community/page.tsx` |
| **Player Profile** | `/community/[playerId]` | Player header, Stats card, Match history | View player attributes, invite to active team | Win rate, match count, preferred hand, court position | "Player not found" warning | `src/app/community/[playerId]/page.tsx` |
| **User Profile / Settings** | `/player` | `useForm`, Avatar upload, Verification banner | Edit full name, phone, hand, skill level, position; upload avatar; step-up delete account | Personal settings, verification status badge, phone number | Profile load error toast; validation messages | `src/app/player/page.tsx` |
| **My Schedule** | `/player/my-schedule` | `Tabs` (Upcoming vs History), Schedule cards | View registered matches, check partner status, withdraw | Match date, club venue, partner name, confirmation badge | "No upcoming events scheduled" with "Browse Events" CTA | `src/app/player/my-schedule/page.tsx` |
| **Clubs Directory** | `/clubs` | `ClubCard`, Admin "Create Club" button | Browse partner clubs, view courts, call venue | Club photo, venue name, address, phone number | Skeletons; "Failed to load clubs" error toast | `src/app/clubs/page.tsx` |
| **Create Club** | `/clubs/create` | Venue form, Photo upload | Input club address, phone, GPS coordinates, notes | Location, coordinates, contact info | Admin role required; upload failure alert | `src/app/clubs/create/page.tsx` |
| **Media Library** | `/media` | Folder browser, Media grid, Upload dialog | Upload photos, copy asset URLs, navigate storage folders | Folder tiles, image thumbnails, full storage paths | "No media items found in this directory" | `src/app/media/page.tsx` |
| **Notifications** | `/notifications` | Notification list, Partner response dialog | Mark as read, mark all read, accept/decline team invites | Invites, promotions, welcome notices, timestamps | "No notifications yet" empty bell state | `src/app/notifications/page.tsx` |
| **Data Manager** | `/admin/data-manager` | Collection picker, Data table, Filter bar, Batch save bar | Inline table edit, batch save, bulk delete, trigger cleanup, sync counts | Raw records across 6 collections; event filters | Admin protection redirect; cell formatting fallbacks | `src/app/admin/data-manager/page.tsx` |

---

## Integrations & External Services

1. **Firebase Authentication:**
   - Email/Password identity management.
   - Google OAuth Provider (`GoogleAuthProvider`).
   - Apple Sign-In OAuth Provider (`OAuthProvider("apple.com")`).
   - Custom claims administration (`admin: true`).
   - *Source: `src/lib/firebase.ts`, `src/lib/firebase-admin.ts`, `functions/src/index.ts`*
2. **Cloud Firestore:**
   - Multi-collection NoSQL persistence (`users`, `events`, `registrations`, `teams`, `clubs`, `notifications`, `counters`, `refresh_token_families`, `revoked_jtis`, `brute_force_attempts`, `auth_audit_logs`, `verification_tokens`).
   - Real-time listeners (`onSnapshot`) for events, rosters, and notifications.
   - Atomic transactions (`runTransaction`) for event creation IDs and team accept/withdraw logic.
   - *Source: `src/lib/firebase.ts`, `collections.json`, `firestore.rules`*
3. **Cloud Storage:**
   - Object storage for profile pictures, event banners, club photography, and general media library assets.
   - *Source: `storage.rules`, `src/lib/upload-helper.ts`*
4. **Firebase Cloud Messaging (FCM Web Push):**
   - Service worker `public/firebase-messaging-sw.js`.
   - Cloud Function `sendPushNotification` listens to `notifications/{id}` document creation and dispatches multicast WebPush notifications to user's registered FCM tokens.
   - *Source: `public/firebase-messaging-sw.js`, `src/hooks/usePushNotifications.ts`, `functions/src/sendPushNotification.ts`*
5. **HaveIBeenPwned API:**
   - External breach database verification using 5-character SHA-1 hash prefix range query (`https://api.pwnedpasswords.com/range/{prefix}`).
   - *Source: `src/lib/auth/password-security.ts#L49-L80`*
6. **Apple Sign-In REST API:**
   - Token revocation endpoint `https://appleid.apple.com/auth/revoke` called during user account deletion.
   - *Source: `src/lib/auth/account-deletion.ts#L15-L46`*
7. **Capacitor Mobile SDK:**
   - Native shell wrappers (`@capacitor/android`, `@capacitor/ios`, `@capacitor/core`) packaging web build (`out` directory) for iOS and Android application targets.
   - *Source: `capacitor.config.ts`, `package.json#L12-L15`*

---

## Open Questions & Missing Implementations

1. **Payment Gateway Integration:** The event schema contains `pricePerPlayer` (e.g. AED 75), but there is **no payment gateway integration** (e.g., Stripe, Checkout.com, Apple Pay) evident in the codebase. Payments are currently uncollected or handled off-platform.
2. **Event Management Screen [RESOLVED]:** Created `src/app/events/[eventId]/manage/page.tsx` integrating the full event management controller directly with `/events/[eventId]/edit`.
3. **External Push Notification Audio / Badging [RESOLVED]:** Added custom notification audio asset (`/sounds/notification.wav`), custom vibration patterns (`[200, 100, 200, 100, 200]`), and badge icon (`/logo.png`) in FCM Cloud Function (`functions/src/sendPushNotification.ts`), Service Worker (`public/firebase-messaging-sw.js`), and frontend listener (`src/hooks/usePushNotifications.ts`).
4. **Automated Shadow Player Invitation Linking:** While shadow players are claimed upon email match during sign-up, there is no email notification automatically sent to offline players when an admin creates their shadow record.
5. **Multi-Court Simultaneous Scheduling:** Events link to a single `clubId` or venue name, but court-level allocation (e.g., Court 1 vs Court 4) is not tracked in the data model.

---

## Evidence Index (Mapped File References)

- **Platform Configuration & Framework:** `package.json`, `next.config.mjs`, `capacitor.config.ts`, `firebase.json`
- **Security Rules & Access Controls:** `firestore.rules`, `storage.rules`, `src/middleware.ts`, `src/lib/auth/rbac-abac.ts`, `src/lib/auth/require-auth.ts`, `src/lib/with-admin-protection.tsx`
- **Authentication Engine:** `src/lib/auth/tokens.ts`, `src/lib/auth/session-family.ts`, `src/lib/auth/jti-revocation.ts`, `src/lib/auth/brute-force.ts`, `src/lib/auth/mfa.ts`, `src/lib/auth/apple-auth.ts`, `src/lib/auth/pkce-oidc.ts`, `src/lib/auth/password-security.ts`, `src/lib/auth/verification-token.ts`, `src/lib/auth/step-up.ts`, `src/lib/auth/account-deletion.ts`, `src/lib/auth/audit-logger.ts`
- **Data Models & Types:** `src/types/index.ts`, `collections.json`, `scenarios.json`
- **API Controllers:** `src/app/api/auth/signup/route.ts`, `src/app/api/auth/signin/route.ts`, `src/app/api/auth/refresh/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/logout-all/route.ts`, `src/app/api/auth/delete-account/route.ts`, `src/app/api/auth/oauth/callback/route.ts`, `src/app/api/auth/mfa/enroll/route.ts`, `src/app/api/auth/mfa/verify/route.ts`, `src/app/api/auth/validate-password/route.ts`, `src/app/api/auth/verify-email/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/list-users/route.ts`, `src/app/api/events/withdraw/route.ts`, `src/app/api/upload/route.ts`, `src/app/api/users/change-password/route.ts`, `src/app/api/users/update-profile/route.ts`, `src/app/api/users/upload-photo/route.ts`
- **Client Pages & Screens:** `src/app/page.tsx`, `src/app/auth/signin/page.tsx`, `src/app/auth/verify-email/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/events/page.tsx`, `src/app/events/create/page.tsx`, `src/app/events/[eventId]/page.tsx`, `src/app/events/[eventId]/edit/page.tsx`, `src/app/community/page.tsx`, `src/app/community/[playerId]/page.tsx`, `src/app/player/page.tsx`, `src/app/player/my-schedule/page.tsx`, `src/app/clubs/page.tsx`, `src/app/clubs/create/page.tsx`, `src/app/media/page.tsx`, `src/app/notifications/page.tsx`, `src/app/admin/data-manager/page.tsx`
- **State Hooks & Core Services:** `src/hooks/useTeamInvite.ts`, `src/hooks/useTeamAccept.ts`, `src/hooks/useTeamDissolve.ts`, `src/hooks/useEventWithdraw.ts`, `src/hooks/usePushNotifications.ts`, `src/hooks/usePwaInstall.ts`, `src/lib/authRequirements.ts`
- **Cloud Functions:** `functions/src/index.ts`, `functions/src/updateEventStatus.ts`, `functions/src/sendPushNotification.ts`
