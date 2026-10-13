# Team Event Registration — Final Master State Transition Specification

**Status:** FINAL — validated scenario-by-scenario and approved; edge-case fine-tuning incorporated 2026-10-08
**Scope:** Teams-based event registration, invitations, waitlist, partner replacement, withdrawal, red-flag eligibility, event capacity and lifecycle

---

# 1. Purpose

This document is the final production-oriented state machine for Teams events.

It defines the authoritative behavior for:

- Solo/free-agent registration
- Community-member invitations
- Registered free-agent invitations
- Reciprocal-invitation prevention
- Multiple simultaneous incoming invitations
- Invitation acceptance, rejection, cancellation and expiration
- Confirmed and waitlisted teams
- Confirmed-team partner replacement
- Replacement grace period
- FIFO waitlist and promotion
- Capacity increases and decreases
- Event closure and event cancellation
- Player withdrawal
- Red-flag eligibility and late-withdrawal handling
- Idempotency, transactions and concurrency protection
- Notifications and audit history

The rules below supersede conflicting or obsolete wording in earlier versions.

---

# 2. Global Business Rules

## 2.1 Red-Flag Eligibility — Global Prerequisite

A player must have:

```text
redflagged == false
a verified account (verified email address and a phone number)
```

to be able to:

```text
register for an event
OR
be invited to an event
```

The server must revalidate eligibility during every relevant state-changing action.

A red-flagged player must not be able to:

```text
create a new event registration
send a standard invitation
receive a new invitation
accept a standard invitation
receive/accept a replacement invitation
be promoted from WAITLIST
```

A pending invitation created while the player was eligible does not bypass this rule. The player must still be eligible at acceptance.

## 2.2 Committed Players Are Not Available for Invitations

A player with an accepted team commitment is unavailable for standard invitations.

Committed states are:

```text
CONFIRMED
WAITLIST
REPLACEMENT_GRACE
```

A committed player must not:

```text
send a standard invitation
receive a standard invitation
accept another standard invitation
```

`REPLACEMENT_GRACE` is the only special case: the remaining player may use the dedicated replacement flow for the vacancy in their existing team.

## 2.3 Free-Agent Rule

A player is a free agent when:

```text
registration.status == PENDING
AND registration.teamId == null
```

Pending invitations do not create a commitment and do not remove free-agent status.

A free agent may have multiple incoming pending invitations.

## 2.4 One Accepted Commitment

A player can have at most one accepted team commitment for an event.

`registration.teamId` represents the accepted commitment only.

A pending proposal must never populate `registration.teamId`.

## 2.5 Community Member Rule

A community member may be invited without being registered for the event.

If the invited community member rejects, expires or has their invitation cancelled:

```text
no registration document is created or modified
```

A registration document is created for the community member only when they accept and enter an accepted team state (`CONFIRMED` or `WAITLIST`).

## 2.6 Registered Free Agent Rule

A registered free agent may have:

- multiple incoming pending invitations;
- one active outgoing pending invitation;
- both incoming and outgoing pending invitations;

while remaining a free agent until one invitation is accepted.

## 2.7 Invitation Cancellation vs Withdrawal

These are different operations.

**Cancel invitation:** the player remains in the event and is free to invite another player.

**Withdraw:** the player leaves the event entirely, subject to the applicable withdrawal flow.

## 2.8 Reciprocal Invitation Rule

A player cannot create:

```text
A → B PENDING
```

when:

```text
B → A PENDING
```

already exists.

The existing invitation must be accepted, declined, cancelled or expired first.

## 2.9 Multiple Incoming Invitations

A free agent may receive multiple pending invitations:

```text
A → D PENDING
B → D PENDING
C → D PENDING
```

D remains a free agent until D accepts one.

The first successful acceptance transaction wins.

## 2.10 One Active Outgoing Invitation

A player may have at most one active outgoing standard `PENDING` invitation.

The player must cancel the current invitation before creating another standard invitation.

For replacement grace, the remaining player may have only one active replacement candidate invitation at a time.

---

# 3. Time Rules

## 3.1 Invitation Expiration

At creation:

```text
invitationExpiresAt = min(
    createdAt + event.inviteTtlHours,
    event.dateTime
)
```

Use:

```text
now < invitationExpiresAt  → valid
now >= invitationExpiresAt → expired
```

Use both scheduled expiration processing and lazy expiration during state-changing actions.

Acceptance and expiration must be mutually exclusive transactions.

## 3.2 Replacement Grace Period

The approved replacement grace period is:

```text
5 minutes
```

It is a fixed business rule unless an explicit future business revision changes the specification.

When a confirmed team member withdraws and the event has more than 3 hours remaining, the remaining player enters `REPLACEMENT_GRACE`.

The deadline is fixed from the original withdrawal:

```text
replacementDeadlineAt = withdrawalTime + 5 minutes
```

The grace period must never be reset or extended because a replacement invitation is cancelled, rejected or expires.

## 3.3 Final 3-Hour Withdrawal Threshold

For a confirmed-team member withdrawal, the final-3-hour threshold is based on the actual event start time:

```text
now >= event.dateTime - 3 hours
```

It is not based on registration deadline.

A qualifying late voluntary withdrawal must display a warning before final confirmation.

## 3.4 Event Start Boundary

At:

```text
now >= event.dateTime
```

no new participation commitment may be created unless an explicit future event policy says otherwise.

---

# 4. Data Model

## 4.1 `events`

```json
{
  "eventId": "<eventId>",
  "eventName": "<String>",
  "adminId":"<String>",    UID of the admin who created the event.
  "status":"<String>",    Current event status ('Upcoming', 'Past', 'Cancelled')
  "duration":"<Number>",    //Duration of the event in minutes.
  "locationName":    "String",//    The name of the venue or club.
  "clubId": "String",// (Optional)    Reference to a document in the 'clubs' collection.
  "coordinates":"<Object>",// {lat: Number, lng: Number}    Geographic location.
  "pricePerPlayer":"<Number>",//    Cost to participate per person.
  "logoUrl":    "String",//URL to the event image/logo.
  "unitType": "teams",
  "slotsAvailable": 10,
  "registrationsCount": 7,
  "waitlistCount": 3,
  "inviteTtlHours": 48,
  "termsAndConditions":    "String",//Rules and policy details.
  "cancellationMessage":"String",//    Reason for cancellation if status is 'Cancelled'.
  "isPublic":"<Boolean>",//    Whether the event is visible to all users
  "createdAt":"<Timestamp>",//    When the event was created.
  "dateTime": "<timestamp>"
}
```

Recommended status values:

```text
Status = UPCOMMING | ONGOING | PAST | CANCELLED
```

`registrationsCount` counts both `CONFIRMED` and `REPLACEMENT_GRACE` teams.

## 4.2 `registrations`

Recommended deterministic identity:

```text
registrations/{eventId}_{playerId}
```

Example:

```json
{
  "registrationId": "<eventId>_<playerId>",
  "eventId": "<eventId>",
  "playerId": "<playerId>",
  "fullName": "<playerName>",
  "status": "PENDING",
  "partnerStatus": "NONE",
  "lookingForPartner": true,
  "teamId": null,
  "waitlistSequence": null,
  "registeredAt": "now()",
  "confirmedAt": null,
  "withdrawnAt": null,
  "cancelledAt": null
}
```

Allowed registration states:

```text
PENDING | CONFIRMED | WAITLIST | CANCELLED
```

Allowed `partnerStatus` values:

```text
NONE | PENDING | CONFIRMED | REPLACEMENT_GRACE
```

## 4.3 Player Red-Flag Fields

At player level:

```json
{
  "redflagged": false,
  "redflaggedAt": null,
  "redflagReason": null,
  "redflagEventId": null
}
```

For an approved late withdrawal:

```json
{
  "redflagged": true,
  "redflaggedAt": "now()",
  "redflagReason": "LATE_WITHDRAWAL",
  "redflagEventId": "<eventId>"
}
```

## 4.4 `teams`

```json
{
  "teamId": "<teamId>",
  "eventId": "<eventId>",

  "player1Id": "<player1Id>",
  "player2Id": "<player2Id>",
  "fullNameP1": "<name>",
  "fullNameP2": "<name>",

  "player1Confirmed": true,
  "player2Confirmed": false,

  "status": "PENDING",
  "invitationExpiresAt": "<timestamp>",

  "waitlistSequence": null,

  "replacementForPlayerId": null,
  "replacementCandidateId": null,
  "replacementInviteExpiresAt": null,
  "replacementDeadlineAt": null,
  "vacantSlot": null,

  "createdAt": "now()",
  "acceptedAt": null,
  "promotedAt": null,
  "cancelledAt": null,
  "cancelledBy": null,
  "cancelReason": null
}
```

Allowed team states:

```text
PENDING
CONFIRMED
WAITLIST
REPLACEMENT_GRACE
CANCELLED
EXPIRED
```

During `PENDING`, player 1 is the inviter and player 2 is the invitee.

During `REPLACEMENT_GRACE`, exactly one slot is occupied by the remaining player and `vacantSlot` identifies the vacancy.

---

# 5. State Definitions

## 5.1 Free Agent

```text
registration.status == PENDING
AND registration.teamId == null
```

## 5.2 Confirmed Member

```text
registration.status == CONFIRMED
AND registration.teamId != null
AND team.status == CONFIRMED
```

## 5.3 Waitlist Member

```text
registration.status == WAITLIST
AND registration.teamId != null
AND team.status == WAITLIST
```

## 5.4 Replacement Grace Member

```text
registration.status == CONFIRMED
AND registration.partnerStatus == REPLACEMENT_GRACE
AND registration.teamId != null
AND team.status == REPLACEMENT_GRACE
```

## 5.5 Withdrawn

```text
registration.status == CANCELLED
```

---

# 6. SC-01 — Solo Player Enters Partner Search Pool

## Trigger

```text
POST /registrations
```

## Preconditions

```text
Event exists
AND event.unitType == teams
AND event.status == UPCOMMING
AND now < event.dateTime
AND player has no active registration for event
AND player.redflagged == false
```

## Transaction

Create the deterministic registration:

```text
status = PENDING
partnerStatus = NONE
lookingForPartner = true
teamId = null
```

No capacity is consumed (at events collection)

Duplicate registration attempts are rejected (must never create a second registration document.)

Send Notifictaions accordingly.

## UI/UX

The registration button status to change form register to withdraw

the user is ordered under the free agent list according to "registeredAt" in ascending order 

---

# 7. SC-02 — Player Withdraws Completely From Event as a Free Agent

## Trigger

```text
POST /registrations/withdraw
```

This applies only when the player has no accepted team commitment.

Players in `CONFIRMED`, `WAITLIST` or `REPLACEMENT_GRACE` use their dedicated team/member withdrawal flows.

## Atomic transaction

1. Find all active pending team proposals involving the player.
2. Cancel those proposals.
3. Recalculate every affected registered player's `partnerStatus`.
4. Set the withdrawing registration to `CANCELLED`.
5. Do not modify capacity counters (at events collection).

Withdrawing player:

```text
status = CANCELLED
partnerStatus = NONE
lookingForPartner = false
teamId = null
withdrawnAt = now()
```

Affected registered counterparties:

```text
teamId = null
partnerStatus = PENDING if another active pending proposal remains
              = NONE otherwise
lookingForPartner = true
```

Unregistered community counterparties have no registration mutation.

### Red-flag rule

A player withdrawing as a **FREE_AGENT never triggers the late-withdrawal red-flag rule**, regardless of how close the withdrawal is to `event.eventStartAt`.

A free agent has no accepted team commitment and consumes no confirmed event capacity. Therefore:

```text
FREE_AGENT withdrawal
→ no late-withdrawal warning
→ no red flag
→ no capacity change
```

The late-withdrawal red-flag rule applies only to the confirmed-team withdrawal path defined in SC-15. WAITLIST withdrawals are also explicitly excluded; see SC-14.

Send Notifictaions accordingly.

## UI/UX

The registration button status to change form withdraw to register

the user is ordered under the changed their minds list according to "withdrawnAt" in ascending order

---

# 8. SC-03 — Player A Invites Player B

## Trigger

```text
POST /teams/invite
```

## Server Preconditions

```text
1. Event exists and is a Teams event.
2. Event status == UPCOMMING.
3. now < dateTime.
4. A & B are verified users (verified emails & phone numbers)
5. A has an active event registration.
6. A.redflagged == false.
7. A has no accepted team commitment.
8. A has no active outgoing STANDARD PENDING invitation.
9. A != B.
10. B.redflagged == false.
11. B has no CONFIRMED team.
12. B has no WAITLIST team.
13. B has no REPLACEMENT_GRACE team.
14. No duplicate A → B PENDING invitation exists.
15. No reciprocal B → A PENDING invitation exists.
```

B may have other pending invitations and may have an outgoing pending invitation while remaining a free agent.

## Registered B (another free agent)

```text
partnerStatus = PENDING
teamId remains null
```

## Community B

```text
no registration created
```

## Team

Create a `PENDING` STANDARD team proposal.

A remains free until acceptance:

```text
teamId = null
partnerStatus = PENDING
lookingForPartner = true
```

No capacity changes (in events collection)

Send Notifictaions accordingly.

## UI/UX

the pending team is ordered under the pending teams list according to "createdAt" in ascending order

invite to a team button for Player B card to be changed to cancel invitation button

---

# 9. SC-04 — Invitee Rejects a Standard Invitation

## Trigger

```text
POST /teams/{teamId}/reject
```

Only the invitee may reject.

If the invitation is already expired when the reject request arrives, lazily transition:

```text
PENDING → EXPIRED
```

rather than treating it as an invalid system state.

## Atomic result

```text
team.status = CANCELLED
cancelReason = PARTNER_DECLINED
cancelledBy = inviteeId
```

For registered participants, recalculate `partnerStatus` from remaining pending proposals.

For a community invitee, do not create or modify registration.

No capacity change.

No red flag is created by rejection or expiration.

Send Notifictaions accordingly.

---

# 10. SC-05 — Inviter Cancels a Standard Invitation

## Trigger

```text
POST /teams/{teamId}/cancel-invite
```

## Preconditions

```text
team.status == PENDING
AND team.invitationType == STANDARD
AND team.player1Id == requestingUser.id
```

## Atomic result

```text
team → CANCELLED
cancelReason = INVITATION_CANCELLED_BY_INVITER
```

The inviter remains in the event and becomes/continues as a free agent:

```text
teamId = null
partnerStatus = PENDING if other incoming proposals exist
              = NONE otherwise
lookingForPartner = true
```

Registered invitee: recalculate if required.

Community invitee: no registration action.

No capacity change.

If the client tries to cancel after the invitation has already been accepted, the server must rely on current server state and reject/return the current state. Client state is never trusted.

## UI/UX

cancel invitation button for Player B card to be changed to invite to a team button

pending team card is removed

---

# 11. SC-06 — Standard Invitation Expiration

## Expiry

```text
invitationExpiresAt = min(
    createdAt + inviteTtl,
    dateTime
  )
```

At expiry:

```text
team.status = EXPIRED
cancelReason = INVITATION_EXPIRED
```

Recalculate registered participants' pending status.

Community members have no registration mutation.

No capacity change.

Acceptance and expiration are mutually exclusive server-side transitions.

Send Notifictaions accordingly.

## UI/UX

for registered player:

cancel invitation button for Player B card to be changed to invite to a team button

pending team card is removed

for community player:

pending team card is removed

---

# 12. SC-07 — Invitee Accepts One of Multiple Invitations

Example:

```text
A → D PENDING
B → D PENDING
C → D PENDING
D → E PENDING
```

D accepts A.

## Preconditions

```text
selected team.status == PENDING
AND selected team.player2Id == D
AND invitation not expired
AND D.redflagged == false
AND A.redflagged == false
AND D has no accepted commitment
AND A has no accepted commitment
```

## Capacity decision

Inside the transaction:

```text
if registrationsCount < slotsAvailable:
    selected team → CONFIRMED
    registrationsCount += 1
else:
    selected team → WAITLIST
    waitlistCount += 1
    assign new atomic waitlistSequence
```

## Selected team

```text
player2Confirmed = true
invitationExpiresAt = null
acceptedAt = now()
```

## Registrations

Both accepted players receive:

```text
teamId = selectedTeamId
status = CONFIRMED or WAITLIST
partnerStatus = CONFIRMED
lookingForPartner = false
```

A community invitee gets the registration document for the first time at this point.

## Competing proposal cascade

All other active pending proposals involving **either committed player** are cancelled atomically.

Example:

```text
A → D SELECTED
B → D CANCELLED / INVITATION_SUPERSEDED
C → D CANCELLED / INVITATION_SUPERSEDED
D → E CANCELLED / INVITATION_SUPERSEDED
F → A CANCELLED / INVITATION_SUPERSEDED
```

For every affected registered player:

```text
teamId = null
partnerStatus = PENDING if another pending proposal remains
              = NONE otherwise
lookingForPartner = true
```

Unregistered community players have no registration mutation.

Send Notifictaions accordingly.

## Critical guarantee

After commit:

```text
A → exactly one accepted commitment
D → exactly one accepted commitment
```

No other acceptance involving A or D can succeed afterward.

## UI/UX

the confirmed/waitlist team is ordered under the respective teams list according to "acceptedAt" in ascending order

Register button for Player B to be changed to withdraw button

---

# 13. SC-08 — Duplicate / Replayed State-Changing Requests

All state-changing endpoints must be idempotent/state-safe.

Example: Accept is submitted twice.

First request:

```text
PENDING → CONFIRMED/WAITLIST
```

Second request sees the current non-PENDING state.

The second request must not:

```text
create another team
create another registration
increment capacity again
affect waitlist sequence again
send duplicate lifecycle side effects
```

Returning the established current result is acceptable.

This rule applies to accept, reject, cancel, withdraw, replacement actions, promotion and related lifecycle mutations.

---

# 14. SC-09 — Confirmed Team Member Withdraws More Than 3 Hours Before Event

## Trigger

```text
POST /teams/{teamId}/withdraw-member
```

## Example

```text
Event start = 21:00
A+B = CONFIRMED
B withdraws = 17:00
```

Because:

```text
17:00 < 18:00
```

SC-09 applies.

## Atomic result

Withdrawing player B:

```text
status = CANCELLED
teamId = null
partnerStatus = NONE
lookingForPartner = false
withdrawnAt = now()
redflagged = true
redflaggedAt = now()
redflagReason = LATE_WITHDRAWAL
redflagEventId = <eventId>
```

B is red-flagged by this scenario because it within the final 18-hour window for morning games, and the 12-hours window for evening games.

Team:

```text
status = REPLACEMENT_GRACE
replacementForPlayerId = B
replacementCandidateId = null
replacementDeadlineAt = now() + 5 minutes 
vacantSlot = B's slot
```

Remaining player A:

```text
status = CONFIRMED
teamId = existingTeamId
partnerStatus = REPLACEMENT_GRACE
lookingForPartner = true
```

Capacity:

```text
registrationsCount unchanged
waitlistCount unchanged
```

The existing confirmed slot remains reserved for 5 minutes only.

this is the grace period till player A finds a replacment to player B



Send Notifictaions accordingly.

---

# 15. SC-10 — Invite Replacement Partner During the 5 minutes Grace

## Trigger

```text
POST /teams/{teamId}/invite-replacement
```

## Preconditions

```text
team.status == REPLACEMENT_GRACE
AND requestingUser == remainingPlayer
AND now < replacementDeadlineAt
AND requestingUser.redflagged == false
AND candidate.redflagged == false
AND candidate has no accepted commitment
AND candidate != remainingPlayer
AND no active replacement invitation exists
AND no reciprocal pending invitation exists
```

## Candidate

Registered candidate:

```text
partnerStatus = PENDING
teamId remains null
```

Community candidate:

```text
no registration created
```

## Replacement invitation expiry

The candidate's invitation must be bounded by the grace deadline:

```text
replacementInviteExpiresAt = min(
    now + inviteTtl,
    event.dateTime
)
```

The grace deadline remains fixed at the original 5 minutes deadline.

Cancelling, rejecting or expiring a candidate does not reset or extend the grace period.

Only the remaining player may manage the replacement invitation.

During grace, the remaining player cannot use the ordinary standard invitation flow; only the replacement flow may be used.

Send Notifications accordingly.

---

# 16. SC-11 — Replacement Invitation Cancellation

## Trigger

```text
POST /teams/{teamId}/cancel-replacement-invite
```

## Preconditions

```text
team.status == REPLACEMENT_GRACE
AND requestingUser == remainingPlayer
AND replacementCandidateId != null
```

## Result

```text
replacementCandidateId = null
replacementInviteExpiresAt = null
```

The team remains:

```text
REPLACEMENT_GRACE
```

The remaining player remains:

```text
CONFIRMED + REPLACEMENT_GRACE
```

The original `replacementDeadlineAt` does not change.

No counters change.

A registered candidate is recalculated as a free agent from remaining pending relationships; an unregistered community candidate has no registration mutation.

Send notifications accordingly.

---

# 17. SC-12 — Replacement Partner Accepts

## Trigger

```text
POST /teams/{teamId}/accept-replacement
```

## Preconditions

```text
team.status == REPLACEMENT_GRACE
AND requestingUser == replacementCandidateId
AND now < replacementInviteExpiresAt
AND now < replacementDeadlineAt
AND requestingUser.redflagged == false
AND remainingPlayer.redflagged == false
AND candidate has no accepted commitment
```

## Atomic transaction

1. Re-read the event and team.
2. Verify the vacancy still exists.
3. Verify the candidate is still the active candidate.
4. Verify all eligibility rules.
5. Fill exactly the vacant slot.
6. Change team `REPLACEMENT_GRACE → CONFIRMED`.
7. Clear replacement fields.
8. Update the remaining player's registration.
9. Create/update the replacement player's registration.
10. Cancel conflicting pending proposals involving the replacement player.
11. Recalculate affected registered players.
12. Keep `registrationsCount` unchanged.
13. Send notifications accordingly

### Slot normalization

The surviving player becomes `player1Id`.

The new replacement player becomes `player2Id`.

Example:

```text
Before:
A = surviving player
B = withdrawn player
vacantSlot = PLAYER2

After:
player1Id = A
player2Id = C
```

If the old surviving player occupied Player 2, normalize the record so that the surviving player still becomes Player 1.

The withdrawn player's identity must be preserved in dedicated audit fields such as `replacementForPlayerId`/lifecycle history.

### Final team

```text
status = CONFIRMED
replacementCandidateId = null
replacementInviteExpiresAt = null
replacementDeadlineAt = null
vacantSlot = null
```

### Important release rule for the withdrawn player

When the replacement is successfully accepted, the player who originally withdrew is completely released from the old team and is not blocked by the old team's former grace period.

That player may immediately, subject to the global eligibility rules if not redflagged:

```text
accept another valid invitation
OR
invite another player
```

They are not required to wait for the original grace deadline.

Send Notifictaions accordingly.

---

# 18. SC-13 — Replacement Grace Expires

## Trigger

Scheduled worker or lazy state transition when:

```text
team.status == REPLACEMENT_GRACE
AND now >= replacementDeadlineAt
```

## Atomic transaction

1. Invalidate any active replacement invitation.
2. Change the old grace team to `CANCELLED`.
3. Convert the remaining player into a normal free agent.
4. Release the reserved confirmed slot.
5. Promote the first eligible waitlisted team if one exists.
6. Update counters.

### Remaining player

The remaining player **stays in the event**:

```text
status = PENDING
teamId = null
lookingForPartner = true
partnerStatus = PENDING if other pending invitations exist
              = NONE otherwise
```

They are not automatically withdrawn and are not red-flagged merely because grace expired.

### Replacement candidate

Any still-pending replacement invitation becomes:

```text
EXPIRED
```

A registered candidate returns to normal free-agent status; an unregistered community candidate has no registration mutation.

### Capacity

If a valid waitlisted team is promoted:

```text
registrationsCount remains unchanged
waitlistCount -= 1
```

If none is available:

```text
registrationsCount -= 1
```

### Notifications

send notifications accodingly

### FIFO

Promotion is based on the first **eligible** waitlisted team by immutable `waitlistSequence`.

---

# 19. SC-14 — Waitlisted Team Withdrawal / Cancellation

## Trigger

```text
POST /teams/{teamId}/cancel
```

## Preconditions

```text
team.status == WAITLIST
AND requestingUser is player1Id or player2Id
```

## Atomic result

Team:

```text
status = CANCELLED
cancelReason = WAITLIST_TEAM_WITHDRAWN
cancelledBy = requestingUserId
cancelledAt = now()
```

Initiating player:

```text
status = CANCELLED
teamId = null
partnerStatus = NONE
lookingForPartner = false
withdrawnAt = now()
```

Other team member:

```text
status = PENDING
teamId = null
partnerStatus = PENDING if other pending invitations exist
              = NONE otherwise
lookingForPartner = true
```

Capacity:

```text
registrationsCount unchanged
waitlistCount -= 1
```

### Explicit red-flag exception

A withdrawal from a `WAITLIST` team **never triggers the late-withdrawal red-flag rule**, regardless of how close the event is.

The initiating player is not red-flagged by this waitlist withdrawal.

The waitlist slot is simply removed, and existing sequence values are not renumbered.

Send Notifications accordingly.

---

# 20. SC-15 — Confirmed Team Member Withdraws Within Final 3 Hours

This is the **late branch of SC-09**, not a separate optional policy.

## Decision rule

```text
now >= event.dateTime - 3 hours
```

## Exact situation

```text
Event starts = 21:00
A+B = CONFIRMED
B attempts withdrawal at 19:00
```

B is inside the final 3-hour window.

## Step 1 — Warning

Before completing the withdrawal, B must receive a clear warning that:

```text
The withdrawal is within the final 3 hours before the event.
Continuing will withdraw the player and mark the player red-flagged.
```

B must explicitly confirm.

If B cancels the warning:

```text
team remains CONFIRMED
no red flag
no capacity change
```

## Step 2 — Server-side confirmation

When B confirms, the server revalidates:

```text
team is still CONFIRMED
B is still a member
current time is within final 3 hours
B is still eligible to perform the action
```

The client warning state is not trusted.

## Step 3 — Atomic result

Team:

```text
A+B → CANCELLED
```

B, the initiating player:

```text
status = CANCELLED
teamId = null
partnerStatus = NONE
lookingForPartner = false
withdrawnAt = now()
```

B is red-flagged:

```json
{
  "redflagged": true,
  "redflaggedAt": "now()",
  "redflagReason": "LATE_WITHDRAWAL",
  "redflagEventId": "<eventId>"
}
```

A, the non-initiating player, remains in the event as a free agent:

```text
status = PENDING
teamId = null
lookingForPartner = true
partnerStatus = PENDING if other pending invitations exist
              = NONE otherwise
```

A is **not** red-flagged.

The confirmed slot is released and FIFO promotion is evaluated.

---

# 21. SC-16 — Waitlist Team Becomes Invalid Before Promotion

Whenever a slot becomes available, the server revalidates the first waitlisted team immediately before promotion.

Minimum promotion checks:

```text
team.status == WAITLIST
AND both players belong to the team
AND both registrations exist
AND both registrations point to this team
AND neither player has an accepted commitment elsewhere
AND both players.redflagged == false
AND event permits promotion
```

If the first queued team is invalid:

```text
WAITLIST → CANCELLED or EXPIRED
```

with an appropriate reason such as:

```text
PLAYER_INELIGIBLE
TEAM_INVALID
```

Then evaluate the next eligible waitlisted team.

Send Notifications accordingly

FIFO means:

> first eligible team by `waitlistSequence`, not simply the first record regardless of eligibility.

---

# 22. SC-17 — Event Cancellation

## Trigger

Administrator cancels the event.

## Event

```text
eventStatus → CANCELLED
```

## Teams

```text
PENDING → CANCELLED
WAITLIST → CANCELLED
REPLACEMENT_GRACE → CANCELLED
CONFIRMED → CANCELLED
```

## Registrations

Active registrations associated with the event become:

```text
status = CANCELLED
teamId = null
lookingForPartner = false
partnerStatus = NONE
```

The cancellation is not a player withdrawal and must not red-flag players.

## Notifications

**Every player who is CONFIRMED or WAITLISTED at the moment of event cancellation must receive an `EVENT_CANCELLED` notification.**

That means both players in every affected confirmed or waitlisted team are notified.

Appropriate cancellation notifications are also generated for other relevant active participants according to the application's notification policy.

## Capacity

Final state:

```text
registrationsCount = 0
waitlistCount = 0
```

## Idempotency

Repeating event cancellation must not double-decrement counters or duplicate lifecycle mutations.

---

# 23. SC-18 — Event Capacity Increased

Example:

```text
slotsAvailable = 10
registrationsCount = 10
waitlistCount = 3
```

Admin increases capacity to 12.

The system promotes eligible waitlisted teams FIFO until the newly available capacity is consumed.

Example:

```text
101 X+Y → CONFIRMED
102 A+B → CONFIRMED
103 C+D → remains WAITLIST
```

Counters:

```text
registrationsCount = 12
waitlistCount = 1
```

Every promoted player receives the appropriate promotion/confirmation notification.

Promotion must revalidate eligibility before each promotion.

Concurrent promotion workers must be protected by transaction state checks so the same team cannot be promoted twice.

all lists are order in Chronological order

---

# 24. SC-19 — Event Capacity Decreased

## Core rule

If:

```text
slotsAvailable < registrationsCount
```

The system must reduce active confirmed occupancy to the new capacity **without randomly cancelling teams**. The goal is to preserve the most reliable existing confirmed commitments.

For this specification, a fully intact two-player `CONFIRMED` team is considered more reliable than a `REPLACEMENT_GRACE` team because the latter has only one active player and an open vacancy.

### Critical precedence rule for `REPLACEMENT_GRACE`

A `REPLACEMENT_GRACE` team must **never be moved to `WAITLIST`**. A WAITLIST team must have two committed players.

If a grace team would otherwise be selected for demotion because of the capacity reduction:

```text
REPLACEMENT_GRACE → CANCELLED
```

The grace period is terminated immediately. The remaining player:

```text
status = PENDING
teamId = null
partnerStatus = PENDING if another active pending proposal remains, otherwise NONE
lookingForPartner = true
```

The remaining player is **not penalized and not red-flagged**. No late-withdrawal warning is shown because this is an administrative capacity change, not a player-initiated withdrawal.

Any active replacement invitation attached to the grace team is cancelled/invalidated, and any registered replacement candidate is recalculated from their remaining pending relationships.

### Capacity-reduction algorithm

1. Preserve as many fully intact `CONFIRMED` teams as possible.

2. Evaluate the teams affected by the reduction using current server state.

3. If a candidate is `REPLACEMENT_GRACE`, terminate that grace team rather than demoting it to WAITLIST.

4. After each grace-team termination, recompute `registrationsCount`. The released slot may reduce or eliminate the need to demote any intact team.

5. If additional reduction is still required, demote the latest fully intact `CONFIRMED` teams to `WAITLIST` until:
   
   ```text
   registrationsCount == slotsAvailable
   ```

6. Demote intact confirmed teams in reverse confirmation order: the latest eligible intact confirmed team goes first.

7. Assign new immutable `waitlistSequence` values to newly demoted teams in their original confirmation order.

8. Append newly demoted teams after the existing waitlist; they must not bypass teams that were already waiting.

9. Preserve all team and player lifecycle history.

10. Never randomly cancel teams and never place a one-player grace team into WAITLIST.

### Example A — Grace teams absorb the reduction

```text
New capacity = 8
Existing occupancy = 10

8 fully intact CONFIRMED teams
2 REPLACEMENT_GRACE teams
```

Both grace teams are terminated:

```text
Grace Team 1 → CANCELLED
Grace Team 2 → CANCELLED
Remaining players → FREE_AGENT
```

Final result:

```text
8 fully intact teams → CONFIRMED
confirmedTeamsCount = 8
No team from this reduction is placed in WAITLIST
```

### Example B — One intact team must be demoted

```text
New capacity = 8
Existing occupancy = 10

9 fully intact CONFIRMED teams
1 REPLACEMENT_GRACE team
```

First:

```text
REPLACEMENT_GRACE → CANCELLED
remaining player → FREE_AGENT
confirmedTeamsCount = 9
```

One additional reduction is still required, so the latest intact confirmed team is demoted:

```text
latest intact CONFIRMED → WAITLIST
confirmedTeamsCount = 8
```

### Reliability rule

After capacity reduction, the remaining confirmed set should be:

```text
fully intact two-player confirmed teams
        BEFORE
partially occupied grace teams
```

A grace team that cannot be retained because of the new capacity is ended cleanly and its remaining player is returned to the free-agent pool rather than being placed into an invalid WAITLIST state.

Send Notifications accordingly.

# 25. SC-20 — Event Registration Deadline / Closure

After:

```text
now >= dateTime
OR status == ONGOING
```

## Standard participation closure

New standard participation creation is closed:

```text
new solo registration → REJECTED
new standard invitation → REJECTED
standard pending invitation acceptance → REJECTED
```

Therefore:

```text
STANDARD PENDING invitation + now >= dateTime
→ acceptance rejected
```

Standard invitations that can no longer be accepted are invalidated/expired according to the lifecycle policy and retained for audit.

Existing confirmed teams are not affected merely because registration has closed. Existing waitlisted teams may still be promoted before event start when event policy permits promotion.

## Replacement-flow exception

The standard `dateTime` can close an already-active replacement flow for a confirmed team.

The effective replacement closing time is:

```text
min(replacementDeadlineAt, event.dateTime)
```

While:

```text
team.status == REPLACEMENT_GRACE
AND now < min(replacementDeadlineAt, event.dateTime)
```

the remaining player may:

```text
create a replacement invitation
AND
a replacement candidate may accept it
```

But not when:

```text
now >= event.dateTime
OR status == ONGOING
```

The replacement flow remains subject to its own eligibility rules, including `redflagged == false` for the relevant player, the replacement invitation expiry, and the requirement that the team is still in `REPLACEMENT_GRACE`.

At:

```text
now >= min(replacementDeadlineAt, event.dateTime)
```

no new replacement invitation or replacement acceptance is allowed.

At `dateTime`, the event-start boundary takes precedence over all other participation changes.

The server, not the client, determines every deadline using server time.

# 26. SC-21 — Event Start

At:

```text
now >= dateTime
```

the event transitions to:

```text
UPCOMING → ONGOING
```

No new:

```text
registration
standard invitation
replacement invitation
invitation acceptance
replacement acceptance
waitlist promotion
```

is allowed unless an explicit future event policy states otherwise.

Existing confirmed teams remain confirmed.

Pending invitations cannot become commitments after event start.

All time comparisons use server time.

---

# 27. SC-22 — Player Re-registers After Withdrawing

A player who previously withdrew as a free agent may register again while the event remains open, provided:

```text
event is still accepting registrations
AND player.redflagged == false
```

The deterministic registration document is reused:

```text
CANCELLED → PENDING
```

with:

```text
teamId = null
partnerStatus = NONE
lookingForPartner = true
withdrawnAt = null
```

This does not resurrect the player's previous team or old invitation proposals.

Any stale prior pending proposals must not be revived.

No capacity change occurs.

A red-flagged player cannot re-register until an authorized administrator clears the red flag.

Send Notifications accordingly.

---

# 28. SC-23 — Red Flag Clearance by Administrator

A red flag does not expire automatically.

Only an authorized administrator may clear it.

## Before

```json
{
  "redflagged": true,
  "redflaggedAt": "<timestamp>",
  "redflagReason": "LATE_WITHDRAWAL",
  "redflagEventId": "<eventId>"
}
```

## Administrative clear

```json
{
  "redflagged": false,
  "redflaggedAt": null,
  "redflagReason": null,
  "redflagEventId": null
}
```

After clearance, the player is eligible again, subject to ordinary event rules.

Clearing a red flag is an explicit administrative action; it is not automatic because time has passed.

---

# 29. Waitlist Architecture

## 29.1 Immutable Sequence

Each team entering the active waitlist receives an immutable sequence:

```text
waitlistSequence
```

Queue order:

```text
ORDER BY waitlistSequence ASC
```

Displayed positions such as `#1`, `#2` are derived for UI and are not stored as the primary ordering mechanism.

## 29.2 No Mass Renumbering

Never rewrite all waitlisted teams after every cancellation, promotion or insertion.

If:

```text
A = 101
B = 102
C = 103
```

and B leaves:

```text
A = 101
C = 103
```

## 29.3 Re-formed Team Gets a New Sequence

If a player later forms a new waitlisted team after becoming a free agent, that **new team** receives a new waitlist sequence.

The new team does not inherit:

```text
previous team creation time
previous waitlist sequence
previous registration time
```

Example:

```text
X+Y formed at 21:20 → sequence 201
A+Z formed at 21:30 → sequence 202
```

X+Y is promoted before A+Z.

A's historical participation in an earlier confirmed team gives A+Z no priority.

## 29.4 Existing Waitlist Has Priority

Whenever a confirmed slot becomes available:

```text
first eligible existing WAITLIST team
        BEFORE
newly accepted PENDING invitation
```

A newly accepted pending team cannot bypass an existing eligible waitlisted team.

---

# 30. Promotion Transaction Requirements

Whenever a slot becomes available, promotion must be evaluated server-side.

The promotion transaction must:

```text
1. Re-read event.
2. Identify the first eligible waitlisted team by sequence.
3. Re-read the selected team.
4. Verify team.status == WAITLIST.
5. Verify both players and registrations.
6. Verify both players are uncommitted elsewhere.
7. Verify both players are not red-flagged.
8. Verify event permits promotion.
9. Transition WAITLIST → CONFIRMED.
10. Update both registrations.
11. Update counters.
12. Record promotedAt.
13. Create notifications.
```

For Firestore-style implementations, use a transaction with conditional state validation such as:

```text
read team
if team.status != WAITLIST → abort/retry
write team.status = CONFIRMED
```

Do not describe this as SQL row locking; Firestore-style systems rely on transactional reads/writes and retries.

---

# 31. Notification Rules

Standard notification types:

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
REPLACEMENT_GRACE_STARTED
REPLACEMENT_INVITE
REPLACEMENT_INVITE_CANCELLED
REPLACEMENT_ACCEPTED
REPLACEMENT_GRACE_EXPIRED
EVENT_CANCELLED
```

All notification types should use consistent casing.

Every notification should carry enough context to navigate to the event/team when applicable:

```text
userId
fromUserId (when applicable)
message
eventId
teamId (when applicable)
createdAt
read
```

Event cancellation must notify every confirmed and waitlisted player.

Late withdrawal warning must be shown before a qualifying player confirms the withdrawal; the warning itself is not the red-flag action.

---

# 32. Audit and Deletion Policy

Normal lifecycle team records must not be deleted.

For rejection, cancellation and expiration use:

```text
status = CANCELLED or EXPIRED
cancelReason = ...
cancelledAt = ...
```

Preserve withdrawn-player identity and replacement history.

Hard deletion is reserved for explicit data-retention/privacy operations.

---

# 33. Atomicity and Concurrency Requirements

All critical state-changing actions must be performed by a server-side transaction or equivalent atomic orchestration.

## Required atomic operations

### Standard invitation acceptance

Must cover:

```text
selected team
inviter registration
invitee registration creation/update
competing pending proposals involving committed players
affected registered counterparties
event counters
waitlistSequence when applicable
notifications/lifecycle side effects where supported atomically
```

### Confirmed member withdrawal

Must cover:

```text
team
withdrawing registration
remaining registration
red-flag decision where applicable
replacement deadline where applicable
```

### Replacement acceptance

Must cover:

```text
existing team
remaining player
replacement player registration
competing invitations involving replacement player
```

### Grace expiry / promotion

Must cover:

```text
grace team
remaining player's registration
event counters
promoted team
promoted registrations
waitlist counter
```

### Waitlist cancellation

Must cover:

```text
cancelled team
both registrations
waitlist count
```

### Capacity decrease

The demotions and counter changes must be handled consistently so the event cannot remain in a partially updated state.

---

# 34. Race Conditions That Must Be Protected

The backend must correctly handle:

```text
1. D accepts A while D has B/C pending.
2. D accepts A while A has another incoming invitation.
3. Accept vs Reject at the same time.
4. Accept vs Invitation Expiry at the same time.
5. Accept vs Withdraw at the same time.
6. Double-click Accept.
7. Two users invite the same community member simultaneously.
8. Two replacement candidates attempt to accept the same vacancy.
9. Two processes attempt to promote the same waitlisted team.
10. A waitlisted team becomes invalid immediately before promotion.
11. A player becomes red-flagged after an invitation was created but before acceptance.
12. A player becomes committed while another invitation action is in flight.
13. Capacity changes while promotion is in flight.
14. Event cancellation occurs while an acceptance/promotion is in flight.
```

Every state-changing endpoint must validate the expected previous state server-side.

---

# 35. Critical Invariants

## Registration consistency

### CONFIRMED

```text
registration.status == CONFIRMED
AND registration.teamId != null
AND team.status == CONFIRMED
AND player belongs to team
```

### WAITLIST

```text
registration.status == WAITLIST
AND registration.teamId != null
AND team.status == WAITLIST
AND player belongs to team
```

### FREE AGENT

```text
registration.status == PENDING
AND registration.teamId == null
AND registration.lookingForPartner == true
```

The player may have multiple pending proposals.

### REPLACEMENT GRACE

```text
registration.status == CONFIRMED
AND registration.partnerStatus == REPLACEMENT_GRACE
AND registration.teamId != null
AND team.status == REPLACEMENT_GRACE
```

### CANCELLED

```text
registration.status == CANCELLED
AND registration.teamId == null
AND registration.lookingForPartner == false
```

## Team consistency

```text
CONFIRMED team → exactly two players
WAITLIST team → exactly two players
PENDING team → inviter + invitee
REPLACEMENT_GRACE → one active player + one explicit vacancy
```

## Capacity consistency

```text
registrationsCount
= count(teams where status == CONFIRMED)
+ count(teams where status == REPLACEMENT_GRACE)
```

A `PENDING` or `WAITLIST` team consumes no confirmed slot.

## Commitment consistency

```text
A player can have at most one accepted team commitment per event.
```

## Eligibility consistency

Any action that creates or establishes a new player/team participation commitment must verify:

```text
player.redflagged == false
```

---

# 36. Final Decision Tree for Confirmed-Team Member Withdrawal

```text
CONFIRMED member requests withdrawal
            │
            ▼
   Determine current server time
            │
            ├── now < eventStartAt - 3 hours
            │        │
            │        ▼
            │      SC-09
            │      5 Minutes replacement grace
            │
            └── now >= eventStartAt - 3 hours
                     │
                     ▼
                   SC-15
             warning + explicit confirmation
                     │
                     ▼
             initiator withdrawn
             initiator redflagged
             other player → FREE_AGENT
             slot released
             FIFO promotion
```

Waitlist withdrawal is separate and does **not** enter this red-flag path.

---

# 37. Final Business Rules Summary

```text
1. redflagged == false is required to register or be invited.
2. Red-flag status is checked again at acceptance/promotion.
3. Committed players cannot send or receive standard invitations.
4. A player can have only one accepted team commitment.
5. Pending invitations never populate registration.teamId.
6. Registered free agents remain free while invitations are pending.
7. Community members may be invited without event registration.
8. Community members receive registration only when an invite is accepted.
9. A player may have multiple incoming invitations.
10. A player may have only one active outgoing standard invitation.
11. Reciprocal pending invitations are blocked.
12. Accepting one invitation atomically invalidates competing proposals involving either committed player.
13. Invitation TTL is bounded by invite TTL, registration deadline and event start.
14. Rejection, cancellation and expiration do not consume capacity.
15. Standard invitation cancellation keeps the inviter in the event.
16. Free-agent withdrawal cancels active pending proposals and the player's registration.
17. Confirmed partner withdrawal more than 3 hours before event start enters a fixed 5 minutes replacement grace period.
18. Replacement candidate invitations cannot extend the original grace deadline.
19. Successful replacement ends grace immediately.
20. The player who withdrew from the old team is immediately free once replacement succeeds.
21. If grace expires, the remaining player becomes a free agent; they are not automatically withdrawn.
22. FREE_AGENT withdrawal never triggers the late-withdrawal red-flag rule.
23. WAITLIST withdrawal never triggers the late-withdrawal red-flag rule.
24. Confirmed-team withdrawal inside the final 3 hours requires an explicit warning and confirmation.
25. Only the player who initiates and confirms the qualifying late withdrawal is red-flagged.
26. The non-initiating confirmed teammate becomes a free agent and is not red-flagged.
27. Waitlist is FIFO by immutable sequence.
28. FIFO means first eligible team, not merely first stored team.
29. A newly re-formed team receives a new waitlist sequence.
30. Existing waitlisted teams have priority over newly accepted pending teams when a slot opens.
31. Capacity increases promote eligible waitlisted teams FIFO.
32. Capacity decreases preserve fully intact confirmed teams, terminate grace teams rather than waitlisting them, and demote only the latest intact confirmed teams as needed.
33. Capacity reduction never randomly cancels teams.
34. Capacity reduction never places a one-player grace team into WAITLIST.
35. Demoted teams are appended to the end of the existing waitlist.
36. Event cancellation does not red-flag players.
37. Event cancellation notifies every confirmed and waitlisted player.
38. After the standard registration deadline, new standard registrations/invitations and standard pending-invitation acceptance are rejected.
39. Replacement invitations and replacement acceptance may continue after the standard registration deadline while the replacement grace window remains active and before event start.
40. At event start, new participation changes stop unless an explicit future policy says otherwise.
41. Re-registration after a previous cancellation reuses the deterministic registration record and does not revive old teams.
42. Red flags require explicit administrative clearance.
43. All critical transitions are server-side atomic and idempotent.
44. Normal lifecycle team records are retained for audit/history.
```

---

# 38. Implementation Checklist

```text
[ ] Global redflagged == false eligibility enforced on registration
[ ] Global redflagged == false eligibility enforced on invitations
[ ] Global redflagged == false eligibility enforced on acceptance
[ ] Global redflagged == false eligibility enforced on replacement
[ ] Global redflagged == false eligibility enforced on waitlist promotion
[ ] Committed players blocked from standard invite send/receive
[ ] All reads must happen before writes
[ ] One registration per event/player
[ ] Pending teamId never written to registrations
[ ] Community invitee registration created only on acceptance
[ ] Multiple incoming invitations supported
[ ] One active outgoing invitation enforced
[ ] Reciprocal invitation blocked
[ ] Invitation expiration enforced server-side
[ ] Expiry/accept race protected
[ ] Invitation cancellation distinct from withdrawal
[ ] Free-agent withdrawal implemented with no late-withdrawal red flag
[ ] 5 Minutes replacement grace implemented
[ ] Capacity decrease preserves intact confirmed teams over grace teams
[ ] Capacity decrease terminates grace teams rather than placing them in WAITLIST
[ ] Capacity decrease demotes only latest intact confirmed teams as needed
[ ] Replacement expiry bounded by grace deadline
[ ] Successful replacement immediately ends grace
[ ] Original withdrawn partner is released immediately after replacement
[ ] Grace expiry leaves surviving player as free agent
[ ] Waitlist withdrawal excludes red-flagging
[ ] Final 3-hour withdrawal warning implemented
[ ] Late initiator only is red-flagged
[ ] Non-initiating teammate becomes free agent
[ ] Immutable waitlist sequence implemented
[ ] New re-formed teams receive new sequence
[ ] FIFO eligibility validation implemented
[ ] Waitlist priority over newly accepted pending teams implemented
[ ] Capacity increase promotion implemented
[ ] Capacity decrease demotion-to-waitlist implemented
[ ] Demoted teams appended after existing waitlist
[ ] No random team cancellation
[ ] Event cancellation notification sent to every confirmed/waitlisted player
[ ] Deadline closure enforced server-side
[ ] Event start boundary enforced server-side
[ ] Re-registration supported without resurrecting old teams
[ ] Admin red-flag clearance implemented
[ ] Idempotency/state-safety implemented
[ ] Firestore-style transaction checks used for race protection
[ ] All lists are order in Chronological order
[ ] Lifecycle team records retained for audit
```
