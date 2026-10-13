# Event Unit Type Conversion Specification (v1.0)

**Status:** Draft / Proposed Extension  
**Scope:** Specification for migrating active events between individual format (`unitType == "players"`) and doubles/teams format (`unitType == "teams"`).  
**Companion Documents:**  

- `Individual_Player_Event_Registration_State_Transition_Spec_V4_2.md`
- `Team_Event_Registration_Spec_Final_Simplified_v3.md`

---

## 1. Context & Capacity Baseline

### 1.1 Existing Capacity Controls

Both parent specifications already define capacity modification workflows:

- **Individual Player Spec (`V4.2`)**:
  - `SC-05 (Capacity increased)`: Updates `slotsAvailable` transactionally and triggers the async FIFO promotion worker (`SC-04`).
  - `SC-06 (Capacity decreased)`: Fast-path transaction for $\le 20$ excess demotions using deterministic timestamp offsets; leased multi-step worker with run tokens for $> 20$ excess demotions.
- **Team Event Spec (`v3.0`)**:
  - `SC-09 (Admin Capacity Changes)`: Increases trigger centralized FIFO promotion (`SC-08`); decreases demote the latest confirmed teams (reverse `acceptedAt` order) and append them to the waitlist tail with new `waitlistSequence` values.

### 1.2 Purpose of this Specification

Neither base document covers switching the core unit of participation (`unitType`) after registrations exist. Converting between `teams` and `players` requires handling structural asymmetries:

- Teams represent 2 players bound by mutual consent.
- Individual players represent 1 slot with autonomous registration.

---

## 2. SC-CONV-01: Team Event to Player Event (`teams` $\rightarrow$ `players`)

Converts a doubles event into an individual singles event.

### 2.1 Preconditions

1. Requester is an authorized administrator.
2. `event.status == UPCOMING` and backend server `now < event.dateTime`.
3. `event.unitType == "teams"`.
4. `event.capacityChangeInProgress != true`.
5. No pending lock or unresolved reconciliation flag exists on the event.

### 2.2 Capacity Configuration

The administrator may provide `newSlotsAvailable` (individual slot count).

- **Default calculation:** $\text{newSlotsAvailable} = \text{oldTeamSlots} \times 2$.
- If `newSlotsAvailable < (count(CONFIRMED teams) \times 2)`, an excess cohort exists and must be demoted per Section 2.3.



### 2.3 State Migration Logic

#### Step 1: Confirmed Teams $\rightarrow$ Confirmed Players

1. Each `CONFIRMED` team is dissolved into two individual player registrations.
2. For both players:
   - `status = CONFIRMED`
3. **Capacity Deficit Handling:**
   - If `newSlotsAvailable` is lower than the resulting confirmed player count, calculate:
     excessCount = (confirmedTeams x 2) - newSlotsAvailable
   - Identify the most recently confirmed teams (`acceptedAt DESC`).
   - Demote players from those teams to the waitlist following the timestamp-offset mechanism defined in Individual Spec `SC-06` to preserve cohort order.

#### Step 2: Waitlisted Teams $\rightarrow$ Waitlisted Players

1. All `WAITLIST` teams are dissolved into individual `WAITLIST` registrations.
2. To preserve FIFO priority without using sequence numbers (Individual Spec V4.2 §2.3):
   - Capture a fixed `baseWaitlistAt = now`.
   - Query waitlisted teams in order of `waitlistSequence ASC`.
   - For team index $i$ (where $i \ge 0$), assign waitlist timestamps to the two team members with 1-millisecond increments:
     player1.waitlistedAt = baseWaitlistAt + (2 x i) ms
     player1.waitlistedAt = baseWaitlistAt + (2 x i +1) ms
   - This ensures both team members enter the waitlist together at the exact relative FIFO position their team occupied.

#### Step 3: Pending Teams & Free Agents

1. All players in teams with `PENDING` state are updated:
   
   - `status = PENDING` 
     and they should be treated as waiting list players but to be positioned after all real waiting list players converted from waiting list teams.

2. Existing Free Agents (`status == PENDING`, `teamId == null`):
   
   - Because the Individual model does not support a `PENDING` state, free agents are transitioned directly to `WAITLIST` appended after the converted waitlisted cohort and after the converted pending cohort, ordered by their original `registeredAt ASC` timestamp.

#### Step 4: Event Document Mutation

Update `events/{eventId}`:

```json
{
  "unitType": "players",
  "slotsAvailable": "<newSlotsAvailable>",
  "registrationsCount": "<count of individual CONFIRMED players>",
  "waitlistCount": "<count of individual WAITLIST players> + <count of individual Pending players> + <count of individual free agent players> ",
  "nextWaitlistSeq": null,
  "inviteTtlHours": null
}
```

### 2.4 Transaction & Batching Execution

- If total affected registrations $\le 50$, execute in a single Firestore transaction.
- If total registrations $> 50$:
  1. Set `capacityChangeInProgress = true` with a 2-minute lease.
  2. Block incoming registrations, withdrawals, and updates.
  3. Execute batch transitions idempotently.
  4. Finalize event schema and clear `capacityChangeInProgress = false`.

### 2.5 Audit Trail & Notifications

- Append an audit record to each affected registration:
  - `action: "CONVERTED_TO_INDIVIDUAL"`
  - `reason: "ADMIN_FORMAT_CHANGE"`
- Enqueue `EVENT_CONVERTED_TO_INDIVIDUAL` notifications to all active participants.

leave the teams collection as is just in case the event is converted back to teams event (so it preserves all teams as they were)

---

## 3. SC-CONV-02: Player Event to Team Event (`players` $\rightarrow$ `teams`)

Converts an individual singles event into a doubles/team event.

### 3.1 Preconditions

1. Requester is an authorized administrator.
2. `event.status == UPCOMING` and backend server `now < event.dateTime`.
3. `event.unitType == "players"`.
4. `event.capacityChangeInProgress != true`.

**important note:**

check if the event has any related teams doc, if so use these docs as the primpary source of truth

### 3.2 The Structural Pairing Problem

Individual players cannot be automatically paired into teams because partner selection requires mutual consent (`player1` invites `player2`, and `player2` must accept). Direct automated pairing risks teaming incompatible or non-consenting players.

### 3.3 State Migration Strategy: Priority Team Formation Window

Existing confirmed players are transitioned into a priority Free Agent pool with an exclusive reservation window before general registration opens.

#### Step 1: Capacity Adjustment

Administrator provides `newSlotsAvailable` representing total team slots:
recommendedSlots = [previousIndividualSlots/ 2]

#### Step 2: Individual Registration Migration

1. For every active `CONFIRMED` registration:
   - `status = CONFIRMED`
   - `registeredAt` is preserved from the original registration.
   - lookingForPartner = true (false if there is an existing team doc related to this player)
2. For every active `WAITLIST` registration:
   * `status = PENDING`
   * registeredAt` is preserved from the original registration.
   * lookingForPartner = true (false if there is an existing team doc related to this player)
   * Cancelled registrations remain `CANCELLED`.

#### Step 3: Event Document Mutation

Update `events/{eventId}`:

```json
{
  "unitType": "teams",
  "slotsAvailable": "<newSlotsAvailable>",
  "registrationsCount": 0,
  "waitlistCount": 0,
  "nextWaitlistSeq": 1
}
```



#### Step 4: Team Formation Execution

1. Migrated players use standard Team Event scenarios:
   - `SC-03`: Send partner invitation (`POST /teams/invite`).
   - `SC-05`: Accept partner invitation (`POST /teams/{teamId}/accept`).
2. Priority matching rules:
   - The first accepted teams occupy the `CONFIRMED` capacity (`registrationsCount < slotsAvailable`).
   - Teams formed after capacity fills automatically route to `WAITLIST` with monotonic `waitlistSequence` assignment (`SC-05`).

### 3.4 Audit Trail & Notifications

- Append an audit record to each modified registration:
  - `action: "CONVERTED_TO_TEAMS"`
- Dispatch `EVENT_CONVERTED_TO_TEAMS` notification:
  - Explains the event format has switched to doubles.
    
    

---
