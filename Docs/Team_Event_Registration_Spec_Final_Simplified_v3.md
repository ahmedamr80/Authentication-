# Team Event Registration — Streamlined Final Specification (v3.0)

**Status:** FINAL — supersedes all prior versions
**Scope:** Teams-based event registration, invitations, waitlist, withdrawal, red-flag eligibility, capacity and event lifecycle

---

## 1. Key Design Decisions

1. **No registration deadline.** `event.dateTime` (event start) is the only time boundary.
2. **No replacement grace period.** When a confirmed member withdraws, the team dissolves immediately. The slot goes to the FIFO waitlist (or is released). The remaining player returns to the Free Agent pool. No timers, no interim states.
3. **Tiered late-withdrawal penalty:**
   - Event starts before 12:00 (local) → penalty window = **18 hours** before start
   - Event starts at/after 12:00 (local) → penalty window = **12 hours** before start
4. **Lean state machine.** No `partnerStatus`, no `lookingForPartner`, no replacement fields. Team states: `PENDING | CONFIRMED | WAITLIST | CANCELLED | EXPIRED`.
5. **Solid safeguarding.** Server-side atomicity, idempotency, red-flag revalidation on every commitment-forming action, single-commitment rule, reciprocal-invite block, competing-proposal cascade, and a centralized FIFO promotion transaction.

---

## 2. Time Rules

### 2.1 Event Start Boundary

```text
now <  event.dateTime → participation open
now >= event.dateTime → event ONGOING; all participation closed
```

At the boundary: no new registrations, no new invitations, no invitation acceptances, no waitlist promotions. Pending invitations become `EXPIRED`. Existing confirmed/waitlisted teams are unaffected.

### 2.2 Late-Withdrawal Penalty Window

Penalty applies **only to CONFIRMED players** withdrawing from a CONFIRMED team. Free agents and waitlisted players are never penalized.

```text
startHour = local hour of event.dateTime
startHour <  12 → threshold = event.dateTime - 18 hours
startHour >= 12 → threshold = event.dateTime - 12 hours

now <  threshold → normal withdrawal (no penalty)
now >= threshold → late withdrawal (initiating player red-flagged)
```

### 2.3 Late-Withdrawal Warning

If the withdrawal qualifies as late, the client must show a warning before final confirmation:

> "This withdrawal is within the final [18/12] hours before the event. Continuing will withdraw you and mark your account red-flagged."

- If the user cancels the warning → nothing changes.
- The server **never** trusts the client warning state; it re-evaluates the threshold server-side at confirmation time.

### 2.4 Invitation Expiration

```text
invitationExpiresAt = min(now + event.inviteTtlHours, event.dateTime)
now >= invitationExpiresAt → EXPIRED
```

Enforced via scheduled worker **and** lazy expiration on read. Acceptance and expiration are mutually exclusive transactions.

---

## 3. Data Model

### 3.1 `events`

```json
{
  "eventId": "evt_123",
  "eventName": "Men's Padel Championship",
  "adminId": "usr_admin",
  "status": "UPCOMING",
  "unitType": "teams",
  "slotsAvailable": 8,
  "registrationsCount": 8,
  "waitlistCount": 2,
  "nextWaitlistSeq": 103,
  "inviteTtlHours": 24,
  "dateTime": "2026-11-01T18:00:00Z",
  "createdAt": "2026-10-10T10:00:00Z"
}
```

- `status`: `UPCOMING | ONGOING | PAST | CANCELLED`
- `registrationsCount` = count of CONFIRMED teams.
- `nextWaitlistSeq` = monotonic counter for waitlist assignment (single source, no renumbering).

### 3.2 `registrations`

Deterministic ID: `registrations/{eventId}_{playerId}`

```json
{
  "registrationId": "evt_123_usr_999",
  "eventId": "evt_123",
  "playerId": "usr_999",
  "fullName": "Alex Mercer",
  "status": "PENDING",
  "teamId": null,
  "registeredAt": "2026-10-12T14:00:00Z",
  "confirmedAt": null,
  "withdrawnAt": null
}
```

States: `PENDING` (free agent) | `CONFIRMED` | `WAITLIST` | `CANCELLED`

### 3.3 `teams`

```json
{
  "teamId": "team_abc",
  "eventId": "evt_123",
  "player1Id": "usr_999",
  "player2Id": "usr_888",
  "fullNameP1": "Alex Mercer",
  "fullNameP2": "Sam Drake",
  "player1Confirmed": true,
  "player2Confirmed": false,
  "status": "PENDING",
  "invitationExpiresAt": "2026-10-13T14:00:00Z",
  "waitlistSequence": null,
  "createdAt": "2026-10-12T14:00:00Z",
  "acceptedAt": null,
  "promotedAt": null,
  "cancelledAt": null,
  "cancelledBy": null,
  "cancelReason": null
}
```

States: `PENDING | CONFIRMED | WAITLIST | CANCELLED | EXPIRED`

### 3.4 Player Red-Flag Fields

```json
{
  "redflagged": false,
  "redflaggedAt": null,
  "redflagReason": null,
  "redflagEventId": null
}
```

Set on late withdrawal:

```json
{
  "redflagged": true,
  "redflaggedAt": "now()",
  "redflagReason": "LATE_WITHDRAWAL",
  "redflagEventId": "evt_123"
}
```

Cleared only by an authorized administrator (never expires automatically).

---

## 4. Global Business Rules

1. **Eligibility:** `redflagged == false` AND verified account (email + phone) is required to register, invite, be invited, accept, or be promoted. Revalidated server-side on every commitment-forming action. A pending invitation never bypasses this — eligibility must hold at acceptance time.
2. **Single commitment:** a player has at most one accepted team (CONFIRMED or WAITLIST) per event. `registration.teamId` is set only on acceptance — never while pending.
3. **Free agent:** `registration.status == PENDING AND teamId == null`. May hold multiple incoming pending invitations and one outgoing pending invitation; remains free until one is accepted.
4. **One active outgoing invitation:** at most one outgoing STANDARD `PENDING` invitation per player. Cancel before creating another.
5. **Reciprocal block:** `A → B PENDING` is rejected while `B → A PENDING` exists. Only *pending* invitations block — cancelled/expired history never blocks a new invite.
6. **Committed players unavailable:** players in CONFIRMED or WAITLIST cannot send/receive standard invitations.
7. **Community invitee:** a verified community member may be invited without an event registration. No registration document exists until they accept — at which point their registration is created directly in CONFIRMED or WAITLIST. Rejection/cancellation/expiration of their invitation creates no registration.
8. **Invitation cancellation ≠ withdrawal:** cancelling an invitation keeps the inviter in the event; withdrawal removes the player from the event.

---

## 5. Scenarios

### SC-01 — Solo Player Registers

`POST /registrations`

**Preconditions:** event exists, `unitType == teams`, `status == UPCOMING`, `now < dateTime`, no existing registration for this player, player eligible.

**Transaction:** create `registrations/{eventId}_{playerId}` with `status = PENDING`, `teamId = null`, `registeredAt = now()`. Duplicate attempts rejected via deterministic ID — never a second document.

**Capacity:** none. **UI:** register button → withdraw button; player appears in free-agent list ordered by `registeredAt` ASC.

---

### SC-02 — Free Agent Withdraws

`POST /registrations/withdraw` — only when the player has no accepted commitment.

**Atomic transaction:**
1. Cancel all PENDING teams where the player is player1 or player2 (`cancelReason = PARTNER_WITHDRAWN`).
2. Registration → `CANCELLED`, `teamId = null`, `withdrawnAt = now()`.
3. Recalculate each affected registered counterparty: `teamId = null` (they return to free-agent PENDING).

**Rules:** never red-flagged, never capacity change, no late-withdrawal warning. **UI:** withdraw → register; player moves to "changed their minds" list ordered by `withdrawnAt` ASC.

---

### SC-03 — Player A Invites Player B

`POST /teams/invite`

**Server preconditions:**
1. Event exists, teams type, `UPCOMING`, `now < dateTime`.
2. A and B are verified, `redflagged == false`.
3. A has an active registration and no accepted commitment.
4. A has no active outgoing PENDING invitation.
5. `A != B`.
6. B has no CONFIRMED or WAITLIST team in this event.
7. No `A → B PENDING` exists; no `B → A PENDING` exists.

**Transaction:** create team `PENDING`, `player1Id = A` (inviter), `player2Id = B` (invitee), `player1Confirmed = true`, `player2Confirmed = false`, `invitationExpiresAt = min(now + inviteTtlHours, dateTime)`.

**Capacity:** none. Community B: no registration created. **UI:** B's card shows "cancel invitation"; pending team ordered by `createdAt` ASC.

---

### SC-04 — Invitation Rejected / Cancelled / Expired

- **Reject** (`POST /teams/{id}/reject`, invitee only): team → `CANCELLED`, `cancelReason = PARTNER_DECLINED`, `cancelledBy = inviteeId`.
- **Cancel** (`POST /teams/{id}/cancel-invite`, inviter only): team → `CANCELLED`, `cancelReason = INVITATION_CANCELLED_BY_INVITER`. Inviter stays in the event as free agent.
- **Expire** (`now >= invitationExpiresAt`): team → `EXPIRED`, `cancelReason = INVITATION_EXPIRED`. Lazy on read or via worker.

If a reject/cancel request arrives after expiry, lazily transition to `EXPIRED` instead of erroring. Registered counterparties return to free-agent state; community invitee: no registration action. **No capacity change, no red flag, ever, on these paths.**

---

### SC-05 — Invitee Accepts

`POST /teams/{teamId}/accept`

**Preconditions:** team `PENDING`; requester is `player2Id`; `now < invitationExpiresAt`; `now < event.dateTime`; both players eligible (`redflagged == false`, verified); neither has an accepted commitment.

**Atomic transaction:**
1. **Capacity branch:**
   - `registrationsCount < slotsAvailable` → team → `CONFIRMED`, `registrationsCount += 1`.
   - else → team → `WAITLIST`, `waitlistSequence = nextWaitlistSeq++`, `waitlistCount += 1`.
2. `player2Confirmed = true`, `acceptedAt = now()`, `invitationExpiresAt = null`.
3. Both players' registrations → team's status, `teamId` set, `confirmedAt = now()`. (Community invitee's registration is created here for the first time.)
4. **Competing cascade:** cancel every other PENDING team involving either player (`cancelReason = INVITATION_SUPERSEDED`); affected registered players return to free-agent state.

**Guarantee after commit:** each player has exactly one accepted commitment; no second acceptance can succeed. **UI:** team ordered by `acceptedAt` ASC in the confirmed/waitlist list.

---

### SC-06 — Confirmed Team Member Withdraws

`POST /teams/{teamId}/withdraw-member`

**Preconditions:** team `CONFIRMED`; requester is a member.

**Step 1 — server evaluates lateness** per §2.2/§2.3. If late, the client must show the warning and collect explicit confirmation; the server re-evaluates at confirmation.

**Step 2 — atomic transaction:**
1. Withdrawing player: registration → `CANCELLED`, `teamId = null`, `withdrawnAt = now()`. If late → set red-flag fields (`LATE_WITHDRAWAL`, this event).
2. Remaining player (never penalized): registration → `PENDING`, `teamId = null` — returns to Free Agent pool.
3. Team → `CANCELLED`, `cancelReason = MEMBER_WITHDRAWN`, `cancelledBy = requester`, `cancelledAt = now()`.
4. **Slot reallocation:** run the centralized promotion (SC-08). If a waitlist team is promoted → `waitlistCount -= 1`, `registrationsCount` unchanged. If none eligible → `registrationsCount -= 1`.

Only the initiating player is red-flagged. The teammate is never red-flagged, never warned.

---

### SC-07 — Waitlisted Team Member Withdraws

`POST /teams/{teamId}/withdraw-member` (or `/cancel`) — team `WAITLIST`, requester is a member.

**Atomic transaction:** withdrawing player → `CANCELLED`; remaining player → `PENDING` free agent; team → `CANCELLED` (`cancelReason = WAITLIST_WITHDRAWN`); `waitlistCount -= 1`.

**Never red-flagged, regardless of proximity to event start.** Waitlist sequences are not renumbered.

---

### SC-08 — Centralized Waitlist Promotion (single implementation)

Runs whenever a confirmed slot opens: SC-06 withdrawal, SC-09 capacity increase, or SC-11 event reopening logic — **never** after `event.dateTime`.

**Atomic promotion transaction:**
1. Re-read event.
2. Select the first team by `waitlistSequence` ASC where: `status == WAITLIST`, both members registered, both registrations point to this team, neither player has an accepted commitment elsewhere, both `redflagged == false`, event permits promotion.
3. If ineligible → mark that team `CANCELLED` (`cancelReason = PLAYER_INELIGIBLE`) and evaluate the next. (FIFO = first *eligible* team.)
4. Promote: team → `CONFIRMED`, `promotedAt = now()`, `waitlistSequence` retained for audit; both registrations → `CONFIRMED`; `waitlistCount -= 1`; `registrationsCount` unchanged.
5. Repeat only when the trigger explicitly frees multiple slots (capacity increase).

Concurrent workers are safe via transactional read-then-write with status precondition (`if team.status != WAITLIST → abort/retry`).

---

### SC-09 — Admin Capacity Changes

**Increase** (`newSlots > registrationsCount`):
1. `slotsAvailable = newSlots`.
2. Promote up to `(newSlots - registrationsCount)` teams via SC-08, FIFO. Each promotion increments `registrationsCount` by 1.
3. `waitlistCount` decremented per promotion.

**Decrease** (`newSlots < registrationsCount`):
1. `excess = registrationsCount - newSlots`.
2. Demote the **most recently confirmed** intact CONFIRMED teams (reverse `acceptedAt` order) to `WAITLIST`.
3. Each demoted team gets a **new** `waitlistSequence = nextWaitlistSeq++` — appended after the existing waitlist, never jumping the queue. Registrations → `WAITLIST`.
4. `registrationsCount = newSlots`; `waitlistCount += excess`.

Never randomly cancel teams; administrative changes never red-flag anyone.

---

### SC-10 — Event Cancellation (admin)

Event → `CANCELLED`. All PENDING/CONFIRMED/WAITLIST teams → `CANCELLED`; all active registrations → `CANCELLED` (`teamId = null`). Reset `registrationsCount = 0`, `waitlistCount = 0`.

**Every player in a CONFIRMED or WAITLIST team receives an `EVENT_CANCELLED` notification.** No player is red-flagged. Idempotent: repeat cancellation must not double-decrement or duplicate mutations.

---

### SC-11 — Event Start

`now >= event.dateTime` → `UPCOMING → ONGOING`. All pending invitations → `EXPIRED`. No new registrations, invitations, acceptances, or promotions. Existing confirmed/waitlist teams remain. All comparisons use server time.

---

### SC-12 — Re-registration After Withdrawal

A player whose registration is `CANCELLED` may re-register while the event is open and they are eligible (`redflagged == false`):

```text
CANCELLED → PENDING, teamId = null, registeredAt = now(), withdrawnAt = null
```

The deterministic document is reused; old teams/proposals are never revived; no capacity change. Red-flagged players cannot re-register until an admin clears the flag.

---

### SC-13 — Admin Red-Flag Clearance

Explicit admin action only:

```json
{ "redflagged": false, "redflaggedAt": null, "redflagReason": null, "redflagEventId": null }
```

After clearance the player is eligible again, subject to ordinary rules.

---

## 6. Waitlist Rules (minimal)

1. One monotonic counter (`nextWaitlistSeq`) assigns immutable `waitlistSequence` on entry. Order = `waitlistSequence ASC`.
2. **No renumbering** on cancellation/withdrawal. Gaps are fine.
3. A re-formed team gets a **new** sequence — no inheritance of old timing.
4. Existing waitlist has priority over newly accepted invitations when a slot opens (handled inside SC-08: a freed slot is offered to the waitlist before any new acceptance can occupy it — see §7 race #4).

---

## 7. Race Conditions That Must Be Protected

1. D accepts A while B → D and C → D are pending. → handled by competing cascade.
2. D accepts A while A has another incoming invitation.
3. Accept vs reject simultaneously. → transactional status precondition.
4. Accept vs waitlist promotion simultaneously. → acceptance capacity check and promotion both run in transactions on the event doc; the freed-slot-first rule is enforced because promotion is only triggered by slot-freeing operations, never concurrently with an acceptance that consumed the last slot.
5. Accept vs invitation expiry simultaneously.
6. Accept vs withdraw simultaneously.
7. Double-click accept. → idempotency (§8).
8. Two players invite the same community member simultaneously. → reciprocal/duplicate-pending checks in transaction.
9. Two workers promote the same waitlisted team. → status precondition + retry.
10. Waitlisted team becomes ineligible immediately before promotion. → SC-08 eligibility revalidation.
11. Player red-flagged between invitation creation and acceptance.
12. Player becomes committed while another invitation action is in flight.
13. Capacity change while promotion is in flight.
14. Event cancellation while an acceptance/promotion is in flight.

Every state-changing endpoint validates the expected previous state server-side.

---

## 8. Idempotency & Atomicity

All state-changing endpoints are idempotent/state-safe. Repeating accept/reject/cancel/withdraw returns the established current state without creating teams, registrations, counter increments, sequence assignments, or duplicate notifications.

Atomic transaction boundaries must cover:

| Operation | Atomic scope |
| :--- | :--- |
| Accept | team, both registrations (create for community invitee), competing PENDING proposals, event counters, waitlist sequence |
| Confirmed withdrawal | team, withdrawing registration + red-flag write, remaining registration, promotion (SC-08) |
| Waitlist withdrawal | team, both registrations, waitlist counter |
| Capacity increase/decrease | event doc, all demoted/promoted teams, all affected registrations, counters |
| Event cancellation | event, all teams, all registrations, counters, notifications |

Reads always happen before writes inside the transaction (Firestore-style: transactional read → validate → write, with retries; no SQL row-locking assumptions).

---

## 9. Critical Invariants

```text
CONFIRMED registration  → status CONFIRMED, teamId set, team CONFIRMED, player belongs to team
WAITLIST registration   → status WAITLIST, teamId set, team WAITLIST, player belongs to team
FREE AGENT              → status PENDING, teamId null (may hold pending invitations)
CANCELLED registration  → status CANCELLED, teamId null

CONFIRMED team → exactly 2 players
WAITLIST team  → exactly 2 players
PENDING team   → inviter + invitee

registrationsCount == count(teams where status == CONFIRMED)

At most one accepted commitment per player per event.
Every commitment-forming action verifies redflagged == false server-side.
```

---

## 10. Notifications

```text
PARTNER_INVITE
PARTNER_ACCEPTED
PARTNER_DECLINED
INVITATION_CANCELLED
INVITATION_EXPIRED
INVITATION_SUPERSEDED
REGISTRATION_CONFIRMED
REGISTRATION_WAITLISTED
WAITLIST_PROMOTED
TEAM_CANCELLED
EVENT_CANCELLED
```

Payload: `userId`, `fromUserId` (when applicable), `message`, `eventId`, `teamId` (when applicable), `createdAt`, `read`. Event cancellation notifies every confirmed/waitlisted player. The late-withdrawal warning is client UX only — the red-flag happens solely at server-confirmed withdrawal.

---

## 11. Audit & Retention

Lifecycle team records are never hard-deleted. Rejection/cancellation/expiration write `status`, `cancelReason`, `cancelledAt`, `cancelledBy`. Withdrawn-player identity is preserved on the team record. Hard deletion reserved for explicit privacy/data-retention operations.

---

## 12. Final Business Rules Summary

```text
1.  redflagged == false + verified required to register, invite, be invited, accept, promote.
2.  Eligibility revalidated server-side at every commitment-forming action.
3.  One accepted commitment per player per event; teamId set only on acceptance.
4.  Free agents may hold multiple incoming + one outgoing pending invitation.
5.  Reciprocal PENDING invitations blocked; history never blocks.
6.  Committed (CONFIRMED/WAITLIST) players cannot send/receive standard invitations.
7.  Community invitees get a registration only when they accept.
8.  Invitation TTL = min(now + inviteTtlHours, event.dateTime).
9.  Reject/cancel/expire → no capacity change, no red flag, ever.
10. Accept: capacity branch (CONFIRMED vs WAITLIST) + competing cascade, all atomic.
11. Confirmed withdrawal >18h/12h before start → no penalty; team dissolves; slot → waitlist.
12. Confirmed withdrawal within 18h/12h → warning, explicit confirm, initiating player red-flagged only.
13. Free-agent and waitlist withdrawals never red-flag.
14. No grace period, no interim states — teams are PENDING/CONFIRMED/WAITLIST/CANCELLED/EXPIRED.
15. Waitlist is FIFO by immutable sequence; first ELIGIBLE team; no renumbering.
16. Re-formed teams get new sequences; existing waitlist has priority.
17. Capacity increase promotes FIFO; decrease demotes latest-confirmed teams, appended to waitlist end.
18. Capacity changes never randomly cancel teams, never red-flag.
19. Event start closes all participation; pending invites expire.
20. Event cancellation cancels everything, notifies all committed players, no red flags.
21. Re-registration reuses the deterministic document; old teams never revived.
22. Red flags clear only by explicit admin action.
23. All mutations atomic, idempotent, server-time based.
```

---

## 13. Implementation Checklist

```text
[ ] Eligibility (redflag + verified) enforced on register / invite / accept / promote
[ ] Eligibility revalidated at acceptance time (pending invite does not bypass)
[ ] Deterministic registration ID; no duplicate registrations
[ ] teamId written only on acceptance, never while pending
[ ] Community invitee registration created only on accept
[ ] One active outgoing invitation enforced
[ ] Reciprocal PENDING invitation blocked (history ignored)
[ ] Multiple incoming invitations supported
[ ] Invitation expiry: worker + lazy, min(TTL, event start)
[ ] Accept/expiry race protected (transactional preconditions)
[ ] Accept capacity branch + competing cascade atomic
[ ] Free-agent withdrawal: cancels pending proposals, no penalty
[ ] Confirmed withdrawal: server-side lateness check (18h/12h by start hour)
[ ] Late withdrawal: client warning + server revalidation + red-flag initiator only
[ ] Remaining player returns to free agent, never penalized
[ ] Slot freed → centralized promotion (SC-08), first ELIGIBLE by sequence
[ ] Waitlist withdrawal: no penalty, no renumbering
[ ] Immutable waitlistSequence via single monotonic counter
[ ] Capacity increase: FIFO promotion
[ ] Capacity decrease: demote latest-confirmed, append at end, no random cancels
[ ] Event start boundary enforced server-side
[ ] Event cancellation: all teams/registrations cancelled, counters zeroed, notify all committed
[ ] Re-registration reuses document, never revives old teams
[ ] Admin red-flag clearance implemented
[ ] All endpoints idempotent
[ ] Firestore-style read-before-write transactions with status preconditions
[ ] Lifecycle records retained for audit
[ ] All lists ordered chronologically (createdAt / acceptedAt / registeredAt / withdrawnAt ASC)
```
