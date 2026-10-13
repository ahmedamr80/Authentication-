# Individual Player Event Registration — State Transition Specification

**Version:** V4.2 — Queue and Capacity-Path Corrections Incorporated  
**Status:** Business rules approved; critical queue-order and worker-exit safeguards incorporated; ready for implementation review  
**Scope:** Events where `unitType == "players"`; each registration uses one individual slot.  
**Out of scope:** Teams, partner invitations, replacement grace, team IDs, and team-event rules.

> This specification replaces the earlier individual-player drafts. Use it only for individual-player events. The Team Event Registration specification remains authoritative for team events.

## 1. Implementation principles

Keep the implementation small and understandable:

- Use one registration document per player per event.
- Use server timestamps for ordinary waitlist order. Do not add global sequence counters. During capacity reduction, preserve demoted-player seniority by assigning each demoted player a distinct timestamp after a fixed pre-operation waitlist tail.
- Use Firestore transactions for individual state changes and counter updates.
- Run waitlist promotion asynchronously and make it safe to retry. If counters disagree with query results, flag the event, alert, and exit without spinning or repeatedly retrying.
- For capacity reductions requiring at most 20 demotions, use one atomic transaction. Use a temporary event flag, short lease, and run token only for larger multi-step reductions.
- Preserve a simple append-only audit trail.

The client must never decide eligibility, registration status, capacity, penalty thresholds, or authoritative time. State-changing operations must run on the trusted backend.

## 2. Business rules

### 2.1 Eligibility

A player is eligible to register or be promoted only when all three conditions are true:

```text
player.emailVerified == true
AND player.phoneVerified == true
AND player.redflagged == false
```

Enforce this rule server-side during registration, re-registration, and immediately before waitlist promotion. A red flag does not expire automatically. Only an authorized administrator may clear it.

### 2.2 Registration identity and states

Use the deterministic document path:

```text
registrations/{eventId}_{playerId}
```

Allowed registration states:

```text
CONFIRMED | WAITLIST | CANCELLED
```

There must not be more than one registration document per player per event. Repeated requests must not create duplicate registrations or change counters twice.

Slot accounting:

```text
CONFIRMED = consumes 1 slot
WAITLIST  = consumes 0 confirmed slots
CANCELLED = consumes 0 confirmed slots
```

`events.registrationsCount` counts only `CONFIRMED` records. `events.waitlistCount` counts only `WAITLIST` records.

### 2.3 Waitlist FIFO

Order active waitlist entries by:

```text
ORDER BY waitlistedAt ASC, document ID ASC
```

Use `waitlistedAt` as the primary queue-order field. The document ID is only a deterministic tie-breaker when ordinary entries have equal timestamps; no global sequence counter is needed. During capacity reduction, identify the demotion cohort by selecting the most recently confirmed players first (`confirmedAt DESC`, document ID descending). To preserve seniority within that cohort, timestamps must be assigned in reverse offset order: the first/newest-confirmed player demoted receives the latest timestamp in the cohort, and the last/earliest-confirmed player demoted receives the earliest timestamp in the cohort. All assigned timestamps must be strictly later than the fixed pre-operation waitlist tail, and must not be based on a tail that moves after each demotion. Never store UI position such as `#1` as the source of truth.

When a player leaves the waitlist and registers again later, assign a new `waitlistedAt`, placing them at the tail of the queue.

**No bypass rule:** A new registrant must not take an open slot while an eligible waitlist entry has priority. Run promotion for the existing waitlist before allowing a new registrant to take available capacity, or place the new registrant at the tail and let the promotion worker handle the queue.

### 2.4 Time and event lifecycle

There is **no separate registration deadline**. A player may register or re-register only while:

```text
now < event.dateTime
AND event.status == UPCOMING
AND event.capacityChangeInProgress != true
```

Use trusted server time, never the device clock. The backend must enforce the `dateTime` boundary even if a scheduled job has not yet updated the event status.

At `now >= event.dateTime`, do not accept new registrations, withdrawals, waitlist promotions, or capacity changes. The event lifecycle may transition from `UPCOMING` to `ONGOING`; remaining waitlisted players are not promoted after the start. If a capacity-reduction lease expires, do **not** treat that as permission to bypass `capacityChangeInProgress`; the recovery worker must reclaim and resume the operation first.

Supported event statuses:

```text
UPCOMING | ONGOING | PAST | CANCELLED
```

### 2.5 Late-withdrawal policy

Only a player withdrawing from `CONFIRMED` can receive a late-withdrawal penalty. A player withdrawing from `WAITLIST` is **never** warned or red-flagged, regardless of event start time.

Determine the threshold from the event's local start time using explicit 24-hour intervals:

| Event start time (local 24-hour clock) | Late-withdrawal window |
|---|---:|
| `00:00 <= time < 12:00` | 18 hours before the event |
| `12:00 <= time < 24:00` | 12 hours before the event |

Exactly `12:00` belongs to the 12-hour category. An event starting at exactly `00:00` belongs to the first interval and uses the 18-hour threshold. Use the event's configured local timezone. If the application has no event-specific timezone because all events are in the UAE, use `Asia/Dubai`.

A confirmed-player withdrawal is late when:

```text
now >= event.dateTime - penaltyThreshold
```

If late, the first request must return a warning and make **no changes**. The UI must ask the player to confirm. Only a subsequent request with `acknowledgePenalty == true` may complete the withdrawal. Recheck the event, registration, current time, and penalty inside the final state-changing operation. A confirmed late withdrawal sets `player.redflagged = true` and stores the red-flag details. An ordinary confirmed withdrawal does not red-flag the player.

A waitlist withdrawal never triggers a late-withdrawal warning or red flag. Event cancellation and administrative capacity changes never red-flag players.

## 3. Minimal data model

### 3.1 Event document — `events/{eventId}`

```json
{
  "eventId": "<eventId>",
  "unitType": "players",
  "status": "UPCOMING",
  "dateTime": "<timestamp>",
  "slotsAvailable": 20,
  "registrationsCount": 15,
  "waitlistCount": 3,
  "capacityChangeInProgress": false,
  "pendingSlotsAvailable": null,
  "pendingWaitlistBaseAt": null,
  "capacityLockExpiresAt": null,
  "capacityChangeRunId": null,
  "counterReconciliationNeeded": false,
  "createdAt": "<timestamp>"
}
```

`capacityChangeInProgress`, `pendingSlotsAvailable`, `pendingWaitlistBaseAt`, `capacityLockExpiresAt`, and `capacityChangeRunId` are used only when a capacity reduction requires more than 20 demotions. Reductions requiring 1–20 demotions are completed in one transaction and do not acquire a lease. For a large reduction, `pendingWaitlistBaseAt` stores the waitlist tail timestamp immediately before the operation, or the trusted backend start time if the waitlist is empty. The short-lived lease (for example, two minutes) is renewed during processing. A recovery worker periodically finds expired leases, claims the operation with a new `capacityChangeRunId`, and resumes from current registration states. Every demotion/finalization transaction must verify the current run ID and that the lease has not expired. This prevents an old worker from continuing after another worker has reclaimed the operation. Do not clear the in-progress flag solely because a lease expired. Treat a missing `capacityChangeInProgress` field as `false` for existing events.

`counterReconciliationNeeded` indicates that a backend operation detected a counter/query mismatch. Set it transactionally, emit an alert, and schedule controlled reconciliation. It must not itself trigger another promotion-worker attempt. Clear it only after a reconciliation process has verified or repaired the counters.

### 3.2 Registration document — `registrations/{eventId}_{playerId}`

```json
{
  "registrationId": "<eventId>_<playerId>",
  "eventId": "<eventId>",
  "playerId": "<playerId>",
  "fullName": "<playerName>",
  "status": "CONFIRMED",
  "registeredAt": "<timestamp>",
  "confirmedAt": "<timestamp>",
  "waitlistedAt": null,
  "withdrawnAt": null,
  "cancelledAt": null,
  "cancelReason": null
}
```

`registeredAt` records the latest successful registration or re-registration. `confirmedAt` is set when the player becomes confirmed and cleared when they leave `CONFIRMED`. `waitlistedAt` is set when the player enters the waitlist and cleared when they leave `WAITLIST`. Use `withdrawnAt` and `cancelledAt` for the relevant transition. Do not delete the registration document when a player withdraws; preserve its history.

### 3.3 Audit trail

Append an immutable entry for each successful state transition to:

```text
registrations/{eventId}_{playerId}/audit_trail/{auditId}
```

Each entry should contain:

```json
{
  "action": "REGISTRATION",
  "previousStatus": null,
  "newStatus": "CONFIRMED",
  "reason": null,
  "timestamp": "<server timestamp>"
}
```

Use appropriate action names such as `REGISTRATION`, `RE_REGISTRATION`, `WITHDRAWAL`, `PROMOTION`, `DEMOTION`, `INELIGIBLE_FOR_PROMOTION`, and `EVENT_CANCELLED`. Do not modify old audit entries.

### 3.4 Player red-flag fields

Use the existing player schema where possible. The relevant active fields are:

```json
{
  "redflagged": false,
  "redflaggedAt": null,
  "redflagReason": null,
  "redflagEventId": null
}
```

## 4. State transitions

### SC-01 — Register or re-register

**Preconditions**, checked server-side:

- The event exists and `unitType == "players"`.
- `event.status == "UPCOMING"` and `now < event.dateTime`.
- `capacityChangeInProgress != true`.
- The player passes the eligibility rule.

**Steps:**

1. In one Firestore transaction, read the event, player, and deterministic registration document. Do not query the waitlist collection on the normal registration path. Complete all reads before writes.
2. If the existing registration is already `CONFIRMED` or `WAITLIST`, return it unchanged. Do not change counters or create duplicate audit entries.
3. Use `event.waitlistCount` as the fast-path indicator of whether the waitlist has priority. If it is greater than zero, do not confirm a new registrant ahead of the queue; add the player to `WAITLIST` and trigger the promotion worker after commit.
4. If `event.waitlistCount == 0` and confirmed capacity is available, set `status = CONFIRMED`, `confirmedAt = server timestamp`, `waitlistedAt = null`, and increment `registrationsCount` by one.
5. Otherwise set `status = WAITLIST`, `confirmedAt = null`, `waitlistedAt = server timestamp`, and increment `waitlistCount` by one.
6. Set `registeredAt = server timestamp`; clear old withdrawal/cancellation markers; append `REGISTRATION` or `RE_REGISTRATION` depending on whether a prior cancelled registration existed.
7. Commit the transaction, then send the corresponding confirmation or waitlist notification through the existing notification mechanism.

The event counters are updated transactionally and are the fast-path source for registration decisions. A scheduled/background reconciliation process must compare them with actual registration states and repair discrepancies; do not add a waitlist query to every registration transaction solely to validate the counter.

The registration state and relevant counter must change together in the same transaction.

### SC-02 — Confirmed player withdraws

**Preconditions:** The request belongs to the registration's player; registration is `CONFIRMED`; event is `UPCOMING`; `now < event.dateTime`; no capacity change is in progress.

1. Calculate the penalty threshold using Section 2.5.
2. If the withdrawal is late and `acknowledgePenalty != true`, return a `LATE_WITHDRAWAL_WARNING` response. Do not alter registration, player, event counters, or audit history.
3. When validly confirmed, use a transaction to re-read the event, player, and registration; verify all preconditions again.
4. Set the registration to `CANCELLED`; clear `confirmedAt`; set `withdrawnAt` and `cancelledAt` to server time; set `cancelReason` to `LATE_WITHDRAWAL` or `PLAYER_WITHDREW`.
5. Decrement `registrationsCount` exactly once. If late, set the player's red-flag fields. Append an audit entry.
6. After commit, send `REGISTRATION_WITHDRAWN` and start the waitlist promotion worker if there may be a vacancy.

A repeated withdrawal request against an already `CANCELLED` registration must not decrement counters again. Return the current state or a clear already-withdrawn response.

Suggested warning response:

```json
{
  "error": "LATE_WITHDRAWAL_WARNING",
  "message": "Withdrawing now will red-flag your account. Confirm that you want to proceed.",
  "requiresAcknowledgment": true
}
```

### SC-03 — Waitlisted player withdraws

**Preconditions:** The requesting player owns the registration; its status is `WAITLIST`; event is `UPCOMING`; `now < event.dateTime`; no capacity change is in progress.

In a transaction, set the registration to `CANCELLED`, clear `waitlistedAt`, set withdrawal/cancellation timestamps and `cancelReason = PLAYER_WITHDREW_FROM_WAITLIST`, decrement `waitlistCount` once, and append the audit entry. After commit, send `REGISTRATION_WITHDRAWN`.

**This transition never warns about or applies a red flag for lateness.**

### SC-04 — Waitlist promotion worker

Trigger the worker after a confirmed withdrawal, capacity increase, or another operation that may create an available slot. The worker must be safe to run more than once.

Repeat while the event is `UPCOMING`, before `event.dateTime`, no capacity change is in progress, `registrationsCount < slotsAvailable`, and a waitlisted candidate exists:

1. Query the oldest `WAITLIST` registration using `waitlistedAt ASC`, then document ID ascending.
2. In a Firestore transaction, re-read the event, candidate registration, and candidate player. Recheck event status, start time, available capacity, and candidate status.
3. If another worker already changed the candidate, make no duplicate change and query again.
4. If the candidate is ineligible, set the registration to `CANCELLED`, clear `waitlistedAt`, set `cancelReason = INELIGIBLE_FOR_PROMOTION`, decrement `waitlistCount`, append an audit entry, then continue to the next candidate.
5. If eligible, set `status = CONFIRMED`, set `confirmedAt = server timestamp`, clear `waitlistedAt`, increment `registrationsCount`, decrement `waitlistCount`, and append a promotion audit entry.
6. After a successful promotion, send `WAITLIST_PROMOTED` and continue if capacity remains.

If the query returns no candidate even though `waitlistCount > 0`, **do not set the counter to zero based on that query alone**. In a small transaction, re-read the event; if the mismatch still exists, set `counterReconciliationNeeded = true` without changing either counter. Emit an operational alert and enqueue one idempotent reconciliation task, then terminate this worker invocation immediately with the terminal result code `WAITLIST_COUNTER_MISMATCH`. Do not throw a retryable error, spin in the loop, or immediately re-trigger the promotion worker because the reconciliation flag changed. The trigger must react only to state changes that can require promotion, not to the reconciliation flag itself. The controlled reconciliation process must compare counters with actual registration states and repair any discrepancy before promotion resumes.

Each worker step must validate and update the candidate state and event counters atomically. Notifications should be sent/enqueued only after successful state changes and should be idempotent.

### SC-05 — Capacity increased

Validate that the event is `UPCOMING`, has not started, and no capacity change is already in progress. Update `slotsAvailable` transactionally. If capacity increases, invoke the promotion worker to fill new slots in FIFO order. Recheck player eligibility during every promotion.

### SC-06 — Capacity decreased

Validate administrator authorization, `event.status == UPCOMING`, `now < event.dateTime`, and that no capacity reduction is already in progress.

If the new capacity is greater than or equal to current confirmed occupancy, update `slotsAvailable` directly in a transaction. If the new capacity is lower than `registrationsCount`, calculate:

```text
excessCount = registrationsCount - newCapacity
```

Use two paths to avoid unnecessary lease orchestration for ordinary capacity changes.

**Fast path: `excessCount <= 20`**

1. Complete the entire reduction in one Firestore transaction. Revalidate administrator authorization, `event.status == UPCOMING`, `now < event.dateTime`, `capacityChangeInProgress != true`, and `counterReconciliationNeeded != true`. Read the event and query the `excessCount` most recently confirmed registrations (`confirmedAt DESC`, document ID descending) and the current waitlist tail (`waitlistedAt DESC`, document ID descending). Complete all reads before writes.
2. If fewer than `excessCount` confirmed records are returned, do not change capacity or counters. Set `counterReconciliationNeeded = true`, commit only that flag update, return `COUNTER_RECONCILIATION_REQUIRED`, and emit an alert/schedule controlled reconciliation. Do not retry the same reduction until reconciliation is complete.
3. Capture a fixed base timestamp from the pre-operation waitlist tail. If the waitlist is empty, use the trusted backend time. Do not recalculate the base from newly demoted players.
4. Process the selected demotion cohort in `confirmedAt DESC`, document ID descending order. Let `remainingExcess` be the number of demotions still to apply immediately before each demotion. Assign:

   ```text
   demoted.waitlistedAt = waitlistBaseAt + remainingExcess milliseconds
   ```

   For the fast path, `waitlistBaseAt` is a transaction-local base timestamp; it does not need to be stored on the event. Because the newest-confirmed player is processed first and receives the largest offset, the earliest-confirmed player within the demoted cohort receives the smallest offset and therefore has higher waitlist priority. Every assigned timestamp is strictly later than the pre-operation tail, and every cohort timestamp is distinct.
5. In the same transaction, set each demoted registration to `WAITLIST`, clear `confirmedAt`, append its `DEMOTION` audit entry, update `registrationsCount` and `waitlistCount`, and set `slotsAvailable = newCapacity`. Commit only when all demotions and counters are updated together.
6. After commit, send or enqueue idempotent `CAPACITY_REDUCTION_DEMOTED` notifications for the affected players. Do not red-flag any player for an administrative capacity reduction.

This path uses no lease or in-progress flag. The transaction updates the event document and the relevant registrations, so concurrent registration/withdrawal transactions must retry against the new state. The 20-player threshold keeps registration, audit, and event writes comfortably bounded.

**Large-reduction path: `excessCount > 20`**

1. In a transaction, revalidate the event and query the current waitlist tail. Set `capacityChangeInProgress = true`, `pendingSlotsAvailable = <new capacity>`, `pendingWaitlistBaseAt = <current waitlist tail timestamp, or trusted backend time if the waitlist is empty>`, `capacityChangeRunId = <new unique run token>`, and `capacityLockExpiresAt = <trusted server time + lease duration>`. Do not yet lower `slotsAvailable`.
2. While the flag is true, block registrations, withdrawals, promotions, and competing capacity changes for that event. Existing data remains readable; show a temporary updating state if appropriate. An expired lease does not release the block.
3. Each demotion transaction must re-read the event and verify that the event is not cancelled, `capacityChangeInProgress == true`, the run token matches, and the lease has not expired. Select the most recently confirmed remaining player first (`confirmedAt DESC`, document ID descending). Let `remainingExcess = registrationsCount - pendingSlotsAvailable` immediately before this demotion. Assign the timestamp using the **fixed** `pendingWaitlistBaseAt` captured at operation start:

   ```text
   demoted.waitlistedAt = pendingWaitlistBaseAt + remainingExcess milliseconds
   ```

   Do not query the moving waitlist tail to assign later timestamps. This gives the first/newest-confirmed player the largest offset and later demotions progressively smaller offsets. As a result, after FIFO sorting, the earlier-confirmed players in the demoted cohort are promoted before later-confirmed players, while all demoted players remain behind the pre-existing waitlist.
4. In the same transaction, set the registration to `WAITLIST`, clear `confirmedAt`, decrement `registrationsCount`, increment `waitlistCount`, renew the lease, and append the `DEMOTION` audit entry. One demotion per transaction keeps each leased step bounded. After each successful step, send or enqueue the idempotent demotion notification.
5. Continue until `registrationsCount <= pendingSlotsAvailable`. When complete, finalize in a transaction that rechecks the run token, lease, and event status; set `slotsAvailable = pendingSlotsAvailable`; and clear `pendingSlotsAvailable`, `pendingWaitlistBaseAt`, `capacityLockExpiresAt`, and `capacityChangeRunId`; set `capacityChangeInProgress = false`.
6. If a worker crashes or the lease expires, a scheduled recovery worker must claim the expired operation transactionally by assigning a new `capacityChangeRunId` and lease expiry, then resume from current registration states and the fixed `pendingWaitlistBaseAt`. Every step checks the run token, so a stale worker cannot continue after recovery has claimed the operation. Do not recompute the base timestamp when resuming.

Demoted players join the end of the existing waitlist, but their relative priority must reflect their original confirmation seniority: among players demoted in the same capacity reduction, earlier `confirmedAt` values receive earlier `waitlistedAt` values. Administrative capacity changes never red-flag a player.
### SC-07 — Event starts

At `now >= event.dateTime`, registration, re-registration, withdrawal, waitlist promotion, and capacity changes are blocked regardless of whether `event.status` has been updated yet. Transition `UPCOMING` to `ONGOING` through the app's existing lifecycle mechanism. Do not promote waitlisted players after the start.

### SC-08 — Administrator cancels event

Only an authorized administrator may cancel an event. In a transaction, set `event.status = CANCELLED` and clear `capacityChangeInProgress`, `pendingSlotsAvailable`, `pendingWaitlistBaseAt`, `capacityLockExpiresAt`, and `capacityChangeRunId` so that a pending capacity job cannot continue. Any old worker must validate its run token and stop. Capacity workers must re-read the event and stop if it is cancelled. Then process all registrations currently in `CONFIRMED` or `WAITLIST` to `CANCELLED` in safe, idempotent batches, clearing `confirmedAt`/`waitlistedAt`, setting cancellation timestamps and `cancelReason = EVENT_CANCELLED`, and appending audit entries. Finish with `registrationsCount = 0` and `waitlistCount = 0` after processing is complete.

Notify every registration that was active at cancellation. Re-running cancellation must not double-decrement counters or duplicate state-transition notifications. Event cancellation never red-flags participants.

### SC-09 — Administrator clears red flag

Require an authenticated, authorized administrator. Set `redflagged = false` and clear the active red-flag fields. Record administrator ID, timestamp, and reason in moderation audit history. Do not automatically change or recreate a cancelled registration; the player may register again under the normal rules.

## 5. Invariants that must always hold after a completed operation

1. `registrationsCount` equals the number of registrations with `status == CONFIRMED`.
2. `waitlistCount` equals the number of registrations with `status == WAITLIST`.
3. `0 <= registrationsCount <= slotsAvailable` outside an active capacity-reduction operation. During capacity reduction, other participation changes are blocked and finalization must restore the invariant before clearing the flag.
4. If `capacityChangeInProgress == true`, a pending target, fixed waitlist base timestamp, and valid run metadata exist; lease expiry triggers recovery, not automatic unlocking. Only reductions requiring more than 20 demotions use this flag/lease path.
5. One active registration record exists per player per event.
6. A `CONFIRMED` player has `confirmedAt` set and `waitlistedAt` cleared.
7. A `WAITLIST` player has `waitlistedAt` set and `confirmedAt` cleared.
8. A `CANCELLED` registration consumes no slot and has no active waitlist timestamp.
9. No new player bypasses a higher-priority waitlisted player.
10. No registration, withdrawal, or promotion occurs at or after `event.dateTime`.
11. A waitlist withdrawal, event cancellation, and administrative capacity change never red-flag a player.
12. Every successful state change updates its registration, relevant counters, and audit entry in a consistent server-side operation.

## 6. Notifications

Use the application's existing notification service. At minimum, support these types:

- `REGISTRATION_CONFIRMED`
- `REGISTRATION_WAITLISTED`
- `REGISTRATION_WITHDRAWN`
- `WAITLIST_PROMOTED`
- `CAPACITY_REDUCTION_DEMOTED`
- `EVENT_CANCELLED`
- `RED_FLAG_CLEARED`

Send or enqueue notifications only after the associated state change succeeds. Make notification creation idempotent so backend retries do not create duplicates.

## 7. Firestore and backend safeguards

- Perform all authorization and eligibility checks on the server.
- In each transaction, perform all reads before writes.
- Never perform a query, make a decision using stale results, and assume that a separate batch write makes the query and writes atomic.
- Update registration state and event counters together for each individual transition.
- Expect async workers and triggers to run more than once. Validate current state before changing it. When the promotion worker detects `waitlistCount > 0` but finds no candidate, set `counterReconciliationNeeded`, alert, enqueue one controlled reconciliation task, and terminate with non-retryable `WAITLIST_COUNTER_MISMATCH`; do not spin or re-trigger because the flag changed.
- Use event counters as the registration fast path; reconcile them against actual registration records in a scheduled/background health process rather than querying the waitlist on every registration. Do not zero counters just because a query returned no results.
- For capacity reductions requiring 1–20 demotions, use one atomic transaction with no lease. For reductions requiring more than 20 demotions, block conflicting changes, process idempotently, and make incomplete work resumable. Capacity-reduction leases must be renewed, reclaimed on expiry by a recovery worker, and protected by a changing run token checked by every step. Use a fixed pre-operation waitlist base and decreasing timestamp offsets as the descending-confirmation demotion loop progresses, so queue seniority is preserved.
- Client security rules must prevent direct writes to registration state, counters, red-flag fields, and capacity-operation fields.

## 8. Implementation checklist

```text
[ ] Deterministic registration path is used
[ ] Email verification, phone verification, and red-flag checks run on the backend
[ ] No separate registrationDeadline field or rule is implemented
[ ] Registration closes at event.dateTime, using server time
[ ] Late-withdrawal threshold uses local intervals [00:00, 12:00) = 18 hours and [12:00, 24:00) = 12 hours
[ ] The first late-withdrawal request warns without changing state; confirmation is required
[ ] Waitlist withdrawals never trigger a warning or red flag
[ ] Waitlist order uses waitlistedAt plus document ID tie-breaker; demoted cohorts preserve confirmation seniority using a fixed base timestamp and reverse offsets; no global sequence counters exist
[ ] Existing waitlist entries cannot be bypassed by new registrations
[ ] Promotion worker is idempotent, checks eligibility, and updates counters atomically
[ ] Registration uses event.waitlistCount without an active waitlist query; background reconciliation repairs counter discrepancies
[ ] Promotion worker flags, alerts, and exits non-retryably on waitlist-counter mismatch without looping or immediate re-trigger
[ ] Capacity reduction uses one atomic transaction for up to 20 demotions; only larger reductions use a renewing lease/run token and resumable one-at-a-time demotions
[ ] Event cancellation handles active registrations in idempotent batches
[ ] Audit entries are append-only
[ ] Notifications are sent after successful changes and are idempotent
[ ] Client-side writes to protected fields are denied
```
