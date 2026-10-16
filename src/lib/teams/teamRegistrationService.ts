import { getAdminFirestore } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
    calculateLateWithdrawalWindow,
    getRegistrationDocId,
    getRegistrationRefAndDoc,
    evaluatePlayerEligibility,
    resolvePlayerEligibilityWithAuth,
    normalizeEventDoc,
    createNotificationDoc,
} from "@/lib/events/registrationUtils";
import { createAuditLogEntry } from "@/lib/events/auditLogService";

export interface ServiceResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    requiresConfirmation?: boolean;
    isLate?: boolean;
    warningMessage?: string;
}

export interface PlayerProfileSnapshot {
    uid: string;
    displayName: string;
    photoURL?: string;
    redflagged?: boolean;
}

export { getRegistrationDocId };

/**
 * Normalizes event time and capacity metadata from event document data
 */
export function normalizeEventTimes(data: Record<string, unknown>) {
    const meta = normalizeEventDoc(data);
    return {
        eventStartAt: meta.dateTime,
        eventStartAtTimestamp: meta.dateTimeTimestamp,
        registrationDeadline: meta.dateTime, // In v3.0, event.dateTime is the sole boundary
        registrationDeadlineTimestamp: meta.dateTimeTimestamp,
        slotsAvailable: meta.slotsAvailable,
        inviteTtlHours: meta.inviteTtlHours,
        confirmedTeamsCount: meta.registrationsCount,
        waitlistCount: meta.waitlistCount,
        nextWaitlistSeq: meta.nextWaitlistSeq,
        registrationStatus: meta.status === "CANCELLED" || meta.status !== "UPCOMING" ? "CLOSED" : "OPEN",
        eventStatus: meta.status,
        timeZone: meta.timeZone,
        eventName: meta.eventName,
    };
}

/**
 * Helper to create an in-app notification
 */
function createNotification(
    db: FirebaseFirestore.Firestore,
    batchOrTx: { set: (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => unknown },
    params: {
        userId: string;
        fromUserId?: string;
        eventId: string;
        eventName: string;
        teamId?: string;
        type: string;
        title: string;
        message: string;
        correlationId?: string;
    }
) {
    createNotificationDoc(db, batchOrTx, params);
}

// =========================================================================
// SC-01 & SC-12: Solo / Free Agent Registration & Re-registration
// =========================================================================
export async function registerSoloTeamEvent(
    eventId: string,
    playerId: string,
    callerAuth?: { emailVerified?: boolean; phoneNumber?: string } | null
): Promise<ServiceResult<{ registrationId: string; status: string }>> {
    const db = getAdminFirestore();
    const now = new Date();

    const initialUserSnap = await db.collection("users").doc(playerId).get();
    const initialUserData = initialUserSnap.data() || {};
    const resolvedAuth = await resolvePlayerEligibilityWithAuth(initialUserData, playerId, callerAuth);
    if (!resolvedAuth.eligible) {
        return { success: false, error: resolvedAuth.message };
    }

    if (resolvedAuth.shouldSyncEmail) {
        db.collection("users").doc(playerId).set({ emailVerified: true }, { merge: true }).catch(() => {});
    }

    return await db.runTransaction(async (tx) => {
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
            return { success: false, error: "Event not found." };
        }
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventTimes(eventData);

        if (meta.eventStatus === "CANCELLED") {
            return { success: false, error: "Cannot register for a cancelled event." };
        }
        if (now >= meta.eventStartAt) {
            return { success: false, error: "Registration is closed as the event has already started." };
        }

        // Eligibility Check (redflagged == false AND verified)
        const userRef = db.collection("users").doc(playerId);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const eligibility = evaluatePlayerEligibility(userData, resolvedAuth.authRecord);
        if (!eligibility.eligible) {
            return { success: false, error: eligibility.message };
        }

        const regId = getRegistrationDocId(eventId, playerId);
        const regRef = db.collection("registrations").doc(regId);
        const regSnap = await tx.get(regRef);

        const playerName = (userData.displayName || userData.fullName || userData.fullname || "Player") as string;
        const serverNow = Timestamp.now();

        if (regSnap.exists) {
            const regData = regSnap.data() || {};
            // Single commitment rule: cannot register if already confirmed or waitlisted
            if (regData.status === "CONFIRMED" || regData.status === "WAITLIST") {
                return { success: false, error: "You already have an active commitment in this event." };
            }
            if (regData.status === "PENDING" && !regData.teamId) {
                // Idempotent return for active free agent
                return {
                    success: true,
                    data: { registrationId: regId, status: "PENDING" },
                };
            }

            // SC-12: Re-registering after cancellation
            tx.update(regRef, {
                status: "PENDING",
                teamId: null,
                fullName: playerName,
                fullNameP1: playerName,
                lookingForPartner: true,
                partnerStatus: "PENDING",
                registeredAt: serverNow,
                withdrawnAt: null,
                cancelledAt: null,
                cancelReason: null,
            });
        } else {
            // SC-01: Brand new free agent registration
            tx.set(regRef, {
                registrationId: regId,
                eventId,
                playerId,
                fullName: playerName,
                fullNameP1: playerName,
                status: "PENDING",
                teamId: null,
                lookingForPartner: true,
                partnerStatus: "PENDING",
                registeredAt: serverNow,
                confirmedAt: null,
                withdrawnAt: null,
                cancelledAt: null,
                cancelReason: null,
            });
        }

        const { correlationId } = createAuditLogEntry(db, tx, {
            eventId,
            entityType: "REGISTRATION",
            entityId: regId,
            action: "REGISTERED",
            actorUid: playerId,
            actorName: playerName,
            previousState: regSnap.exists ? { status: regSnap.data()?.status, teamId: regSnap.data()?.teamId } : null,
            newState: { status: "PENDING", teamId: null, lookingForPartner: true },
            reason: "Solo free agent registered",
        });

        createNotification(db, tx, {
            userId: playerId,
            eventId,
            eventName: meta.eventName,
            type: "system",
            title: "Free Agent Registered",
            message: `You are listed as a Free Agent for ${meta.eventName}. Invite a partner or wait for invitations!`,
            correlationId,
        });

        return {
            success: true,
            data: { registrationId: regId, status: "PENDING" },
        };
    });
}

// =========================================================================
// SC-03: Send Standard Team Invitation (Player A invites Player B)
// =========================================================================
export async function sendTeamInvitation(
    eventId: string,
    inviterId: string,
    inviteeId: string,
    inviterAuth?: { emailVerified?: boolean; phoneNumber?: string } | null
): Promise<ServiceResult<{ teamId: string }>> {
    if (inviterId === inviteeId) {
        return { success: false, error: "You cannot invite yourself." };
    }

    const db = getAdminFirestore();
    const now = new Date();

    const [inviterUserSnap0, inviteeUserSnap0] = await Promise.all([
        db.collection("users").doc(inviterId).get(),
        db.collection("users").doc(inviteeId).get(),
    ]);
    const [inviterEval, inviteeEval] = await Promise.all([
        resolvePlayerEligibilityWithAuth(inviterUserSnap0.data(), inviterId, inviterAuth),
        resolvePlayerEligibilityWithAuth(inviteeUserSnap0.data(), inviteeId),
    ]);
    if (!inviterEval.eligible) {
        return { success: false, error: inviterEval.message };
    }
    if (!inviteeEval.eligible) {
        return { success: false, error: "The invited player is currently ineligible to participate." };
    }

    if (inviterEval.shouldSyncEmail) {
        db.collection("users").doc(inviterId).set({ emailVerified: true }, { merge: true }).catch(() => {});
    }
    if (inviteeEval.shouldSyncEmail) {
        db.collection("users").doc(inviteeId).set({ emailVerified: true }, { merge: true }).catch(() => {});
    }

    return await db.runTransaction(async (tx) => {
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
            return { success: false, error: "Event not found." };
        }
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventTimes(eventData);

        if (meta.eventStatus === "CANCELLED") {
            return { success: false, error: "Event has been cancelled." };
        }
        if (now >= meta.eventStartAt) {
            return { success: false, error: "Invitations are closed as the event has already started." };
        }

        // Validate inviter A & invitee B eligibility
        const [inviterUserSnap, inviteeUserSnap] = await Promise.all([
            tx.get(db.collection("users").doc(inviterId)),
            tx.get(db.collection("users").doc(inviteeId)),
        ]);
        const inviterData = inviterUserSnap.data() || {};
        const inviteeData = inviteeUserSnap.data() || {};

        const inviterEligibility = evaluatePlayerEligibility(inviterData, inviterEval.authRecord);
        if (!inviterEligibility.eligible) {
            return { success: false, error: inviterEligibility.message };
        }

        const inviteeEligibility = evaluatePlayerEligibility(inviteeData, inviteeEval.authRecord);
        if (!inviteeEligibility.eligible) {
            return { success: false, error: "The invited player is currently ineligible to participate." };
        }

        // Check inviter active commitment
        const inviterRegId = getRegistrationDocId(eventId, inviterId);
        const inviterRegRef = db.collection("registrations").doc(inviterRegId);
        const inviterRegSnap = await tx.get(inviterRegRef);
        if (inviterRegSnap.exists) {
            const regData = inviterRegSnap.data() || {};
            if (regData.status === "CONFIRMED" || regData.status === "WAITLIST") {
                return { success: false, error: "You are already committed to an existing team." };
            }
        }

        // Check invitee active commitment
        const inviteeRegId = getRegistrationDocId(eventId, inviteeId);
        const inviteeRegRef = db.collection("registrations").doc(inviteeRegId);
        const inviteeRegSnap = await tx.get(inviteeRegRef);
        if (inviteeRegSnap.exists) {
            const regData = inviteeRegSnap.data() || {};
            if (regData.status === "CONFIRMED" || regData.status === "WAITLIST") {
                return { success: false, error: "The invited player is already committed to another team." };
            }
        }

        // Rule 4: Inviter may have at most 1 active outgoing standard PENDING invitation
        const activeOutgoingSnap = await tx.get(
            db.collection("teams")
                .where("eventId", "==", eventId)
                .where("player1Id", "==", inviterId)
                .where("status", "==", "PENDING")
        );
        if (!activeOutgoingSnap.empty) {
            return {
                success: false,
                error: "You already have an active pending invitation. Please cancel it before sending a new one.",
            };
        }

        // Rule 5: Reciprocal block (A -> B blocked if B -> A is PENDING)
        const reciprocalSnap = await tx.get(
            db.collection("teams")
                .where("eventId", "==", eventId)
                .where("player1Id", "==", inviteeId)
                .where("player2Id", "==", inviterId)
                .where("status", "==", "PENDING")
        );
        if (!reciprocalSnap.empty) {
            return {
                success: false,
                error: "This player has already sent you an invitation! Please respond to their invitation instead.",
            };
        }

        // Expiration = min(now + inviteTtlHours, event.dateTime)
        const ttlMs = meta.inviteTtlHours * 3600 * 1000;
        const potentialExpires = new Date(now.getTime() + ttlMs);
        const expiresAtDate = potentialExpires.getTime() < meta.eventStartAt.getTime()
            ? potentialExpires
            : meta.eventStartAt;

        const teamRef = db.collection("teams").doc();
        const inviterName = (inviterData.displayName || inviterData.fullName || "Player 1") as string;
        const inviteeName = (inviteeData.displayName || inviteeData.fullName || "Player 2") as string;

        const serverNow = Timestamp.now();

        tx.set(teamRef, {
            teamId: teamRef.id,
            eventId,
            player1Id: inviterId,
            player2Id: inviteeId,
            fullNameP1: inviterName,
            fullNameP2: inviteeName,
            player1Confirmed: true,
            player2Confirmed: false,
            status: "PENDING",
            invitationExpiresAt: Timestamp.fromDate(expiresAtDate),
            waitlistSequence: null,
            createdAt: serverNow,
            acceptedAt: null,
            promotedAt: null,
            cancelledAt: null,
            cancelledBy: null,
            cancelReason: null,
        });

        // Reuse / update Inviter's registration doc so they are active and no longer appear in Changed Minds
        tx.set(
            inviterRegRef,
            {
                registrationId: inviterRegId,
                eventId,
                playerId: inviterId,
                fullName: inviterName,
                fullNameP1: inviterName,
                playerDisplayName: inviterName,
                status: "PENDING",
                teamId: teamRef.id,
                lookingForPartner: false,
                partnerStatus: "PENDING",
                registeredAt: inviterRegSnap.exists && inviterRegSnap.data()?.registeredAt
                    ? inviterRegSnap.data()?.registeredAt
                    : serverNow,
                withdrawnAt: null,
                cancelledAt: null,
                cancelReason: null,
            },
            { merge: true }
        );

        const { correlationId } = createAuditLogEntry(db, tx, {
            eventId,
            entityType: "TEAM",
            entityId: teamRef.id,
            action: "INVITED",
            actorUid: inviterId,
            actorName: inviterName,
            previousState: null,
            newState: { status: "PENDING", player1Id: inviterId, player2Id: inviteeId },
            reason: `${inviterName} invited ${inviteeName}`,
        });

        createNotification(db, tx, {
            userId: inviteeId,
            fromUserId: inviterId,
            eventId,
            eventName: meta.eventName,
            teamId: teamRef.id,
            type: "PARTNER_INVITE",
            title: "Team Invitation Received 🎾",
            message: `${inviterName} invited you to team up for ${meta.eventName}!`,
            correlationId,
        });

        return { success: true, data: { teamId: teamRef.id } };
    });
}

// =========================================================================
// SC-05: Invitee Accepts Team Invitation
// =========================================================================
export async function acceptTeamInvitation(
    teamId: string,
    inviteeId: string,
    inviteeAuth?: { emailVerified?: boolean; phoneNumber?: string } | null
): Promise<ServiceResult<{ teamId: string; status: "CONFIRMED" | "WAITLIST" }>> {
    const db = getAdminFirestore();
    const now = new Date();

    const teamDocSnap = await db.collection("teams").doc(teamId).get();
    if (!teamDocSnap.exists) {
        return { success: false, error: "Team invitation not found." };
    }
    const teamDocData = teamDocSnap.data() || {};
    const inviterId = teamDocData.player1Id as string;

    const [inviterUserSnap0, inviteeUserSnap0] = await Promise.all([
        inviterId ? db.collection("users").doc(inviterId).get() : null,
        db.collection("users").doc(inviteeId).get(),
    ]);
    const [inviterEval, inviteeEval] = await Promise.all([
        resolvePlayerEligibilityWithAuth(inviterUserSnap0?.data(), inviterId),
        resolvePlayerEligibilityWithAuth(inviteeUserSnap0.data(), inviteeId, inviteeAuth),
    ]);
    if (!inviteeEval.eligible) {
        return { success: false, error: inviteeEval.message };
    }

    if (inviterEval.shouldSyncEmail && inviterId) {
        db.collection("users").doc(inviterId).set({ emailVerified: true }, { merge: true }).catch(() => {});
    }
    if (inviteeEval.shouldSyncEmail) {
        db.collection("users").doc(inviteeId).set({ emailVerified: true }, { merge: true }).catch(() => {});
    }

    return await db.runTransaction(async (tx) => {
        const teamRef = db.collection("teams").doc(teamId);
        const teamSnap = await tx.get(teamRef);
        if (!teamSnap.exists) {
            return { success: false, error: "Team invitation not found." };
        }
        const teamData = teamSnap.data() || {};

        // Idempotency: already accepted
        if (teamData.status === "CONFIRMED" || teamData.status === "WAITLIST") {
            if (teamData.player2Id === inviteeId && teamData.player2Confirmed) {
                return {
                    success: true,
                    data: { teamId, status: teamData.status as "CONFIRMED" | "WAITLIST" },
                };
            }
            return { success: false, error: "This invitation is no longer pending." };
        }

        if (teamData.status !== "PENDING") {
            return { success: false, error: "Invitation is no longer pending." };
        }

        if (teamData.player2Id !== inviteeId) {
            return { success: false, error: "You are not the designated recipient of this invitation." };
        }

        const eventId = teamData.eventId as string;

        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
            return { success: false, error: "Event not found." };
        }
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventTimes(eventData);

        if (meta.eventStatus === "CANCELLED") {
            return { success: false, error: "Event has been cancelled." };
        }

        // Verify expiration
        const expiresAt = teamData.invitationExpiresAt?.toDate() || meta.eventStartAt;
        if (now >= expiresAt || now >= meta.eventStartAt) {
            tx.update(teamRef, {
                status: "EXPIRED",
                cancelReason: "INVITATION_EXPIRED",
                cancelledAt: Timestamp.now(),
            });
            return { success: false, error: "This invitation has expired." };
        }

        // Revalidate eligibility of both players
        const [inviterUserSnap, inviteeUserSnap] = await Promise.all([
            tx.get(db.collection("users").doc(inviterId)),
            tx.get(db.collection("users").doc(inviteeId)),
        ]);
        const inviterUserData = inviterUserSnap.data() || {};
        const inviteeUserData = inviteeUserSnap.data() || {};
        const inviterName = (inviterUserData.displayName || inviterUserData.fullName || "Player 1") as string;
        const inviteeName = (inviteeUserData.displayName || inviteeUserData.fullName || "Player 2") as string;

        const inviterEligibility = evaluatePlayerEligibility(inviterUserData, inviterEval.authRecord);
        if (!inviterEligibility.eligible) {
            tx.update(teamRef, {
                status: "CANCELLED",
                cancelReason: "PLAYER_INELIGIBLE",
                cancelledAt: Timestamp.now(),
            });
            return { success: false, error: "The inviter is no longer eligible to participate." };
        }

        const inviteeEligibility = evaluatePlayerEligibility(inviteeUserData, inviteeEval.authRecord);
        if (!inviteeEligibility.eligible) {
            return { success: false, error: inviteeEligibility.message };
        }

        // Single commitment rule: verify neither player has accepted commitment elsewhere
        const inviterRegId = getRegistrationDocId(eventId, inviterId);
        const inviteeRegId = getRegistrationDocId(eventId, inviteeId);
        const [inviterRegSnap, inviteeRegSnap] = await Promise.all([
            tx.get(db.collection("registrations").doc(inviterRegId)),
            tx.get(db.collection("registrations").doc(inviteeRegId)),
        ]);

        const inviterRegData = inviterRegSnap.data() || {};
        const inviteeRegData = inviteeRegSnap.data() || {};

        if (
            (inviterRegData.status === "CONFIRMED" || inviterRegData.status === "WAITLIST") &&
            inviterRegData.teamId &&
            inviterRegData.teamId !== teamId
        ) {
            tx.update(teamRef, {
                status: "CANCELLED",
                cancelReason: "INVITATION_SUPERSEDED",
                cancelledAt: Timestamp.now(),
            });
            return { success: false, error: "The inviter has already committed to another team." };
        }

        if (
            (inviteeRegData.status === "CONFIRMED" || inviteeRegData.status === "WAITLIST") &&
            inviteeRegData.teamId &&
            inviteeRegData.teamId !== teamId
        ) {
            return { success: false, error: "You are already committed to another team in this event." };
        }

        // Capacity branch:
        const isConfirmedSlotAvailable = meta.confirmedTeamsCount < meta.slotsAvailable && meta.waitlistCount === 0;
        const finalStatus: "CONFIRMED" | "WAITLIST" = isConfirmedSlotAvailable ? "CONFIRMED" : "WAITLIST";

        // Assign waitlistSequence if WAITLIST
        const nextSeq = meta.nextWaitlistSeq;
        const assignedWaitlistSequence: number | null = !isConfirmedSlotAvailable ? nextSeq : null;

        // Competing proposals cascade: cancel every other PENDING team involving either player
        const [competingSnap1, competingSnap2] = await Promise.all([
            tx.get(
                db.collection("teams")
                    .where("eventId", "==", eventId)
                    .where("player1Id", "in", [inviterId, inviteeId])
                    .where("status", "==", "PENDING")
            ),
            tx.get(
                db.collection("teams")
                    .where("eventId", "==", eventId)
                    .where("player2Id", "in", [inviterId, inviteeId])
                    .where("status", "==", "PENDING")
            ),
        ]);

        const competingMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
        for (const d of [...competingSnap1.docs, ...competingSnap2.docs]) {
            if (d.id !== teamId) {
                competingMap.set(d.id, d);
            }
        }
        const competingDocs = Array.from(competingMap.values());

        // Extract the other player IDs from competing teams so their registrations can be read BEFORE writes
        const otherPlayerIds: string[] = [];
        for (const doc of competingDocs) {
            const cd = doc.data();
            const otherId = (cd.player1Id === inviterId || cd.player1Id === inviteeId)
                ? (cd.player2Id as string)
                : (cd.player1Id as string);
            if (otherId && !otherPlayerIds.includes(otherId) && otherId !== inviterId && otherId !== inviteeId) {
                otherPlayerIds.push(otherId);
            }
        }

        const otherRegSnaps = await Promise.all(
            otherPlayerIds.map((uid) =>
                tx.get(db.collection("registrations").doc(getRegistrationDocId(eventId, uid)))
            )
        );
        const otherRegMap = new Map(otherPlayerIds.map((uid, idx) => [uid, otherRegSnaps[idx]]));

        // --- ALL READS COMPLETE. START WRITES ---

        // 1. Update event counts
        if (finalStatus === "CONFIRMED") {
            const newConfirmedCount = meta.confirmedTeamsCount + 1;
            tx.update(eventRef, {
                confirmedTeamsCount: newConfirmedCount,
                registrationsCount: newConfirmedCount,
            });
        } else {
            const newWaitlistCount = meta.waitlistCount + 1;
            tx.update(eventRef, {
                waitlistCount: newWaitlistCount,
                nextWaitlistSeq: nextSeq + 1,
            });
        }

        const serverNow = Timestamp.now();
        const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // 2. Update selected team
        tx.update(teamRef, {
            status: finalStatus,
            player2Confirmed: true,
            invitationExpiresAt: null,
            waitlistSequence: assignedWaitlistSequence,
            acceptedAt: serverNow,
        });

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "TEAM",
            entityId: teamId,
            action: "ACCEPTED",
            actorUid: inviteeId,
            actorName: inviteeName,
            previousState: { status: "PENDING" },
            newState: { status: finalStatus, waitlistSequence: assignedWaitlistSequence },
            correlationId,
            reason: `${inviteeName} accepted invitation from ${inviterName}`,
        });

        // 3. Update inviter registration
        tx.set(
            db.collection("registrations").doc(inviterRegId),
            {
                registrationId: inviterRegId,
                eventId,
                playerId: inviterId,
                status: finalStatus,
                teamId,
                lookingForPartner: false,
                partnerStatus: "CONFIRMED",
                waitlistSequence: assignedWaitlistSequence,
                confirmedAt: serverNow,
            },
            { merge: true }
        );

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "REGISTRATION",
            entityId: inviterRegId,
            action: finalStatus === "CONFIRMED" ? "PROMOTED" : "REGISTERED",
            actorUid: inviteeId,
            actorName: inviteeName,
            previousState: { status: inviterRegData.status, teamId: inviterRegData.teamId },
            newState: { status: finalStatus, teamId, waitlistSequence: assignedWaitlistSequence },
            correlationId,
            reason: `Team formed with ${inviteeName} (${finalStatus})`,
        });

        // 4. Update / create invitee registration (Community invitee registration created here!)
        tx.set(
            db.collection("registrations").doc(inviteeRegId),
            {
                registrationId: inviteeRegId,
                eventId,
                playerId: inviteeId,
                fullName: inviteeName,
                fullNameP1: inviteeName,
                status: finalStatus,
                teamId,
                lookingForPartner: false,
                partnerStatus: "CONFIRMED",
                waitlistSequence: assignedWaitlistSequence,
                registeredAt: inviteeRegSnap.exists ? (inviteeRegData.registeredAt || serverNow) : serverNow,
                confirmedAt: serverNow,
            },
            { merge: true }
        );

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "REGISTRATION",
            entityId: inviteeRegId,
            action: finalStatus === "CONFIRMED" ? "PROMOTED" : "REGISTERED",
            actorUid: inviteeId,
            actorName: inviteeName,
            previousState: inviteeRegSnap.exists ? { status: inviteeRegData.status, teamId: inviteeRegData.teamId } : null,
            newState: { status: finalStatus, teamId, waitlistSequence: assignedWaitlistSequence },
            correlationId,
            reason: `Team formed with ${inviterName} (${finalStatus})`,
        });

        // 5. Competing proposals cascade: cancel every other PENDING team and notify affected players
        for (const doc of competingDocs) {
            const cd = doc.data();
            tx.update(doc.ref, {
                status: "CANCELLED",
                cancelReason: "INVITATION_SUPERSEDED",
                cancelledAt: serverNow,
            });

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "TEAM",
                entityId: doc.id,
                action: "SUPERSEDED",
                actorUid: inviteeId,
                actorName: inviteeName,
                previousState: { status: "PENDING" },
                newState: { status: "CANCELLED", cancelReason: "INVITATION_SUPERSEDED" },
                correlationId,
                reason: "Invitation superseded because player formed another team",
            });

            const isOtherPlayerInviter = cd.player1Id !== inviterId && cd.player1Id !== inviteeId;
            const otherPlayerId = isOtherPlayerInviter ? (cd.player1Id as string) : (cd.player2Id as string);

            if (otherPlayerId && otherPlayerId !== inviterId && otherPlayerId !== inviteeId) {
                // A. Send in-app notification to the affected player
                if (isOtherPlayerInviter) {
                    // Scenario: B invited D, but D accepted A's invitation
                    const acceptedPlayerName = cd.player2Id === inviteeId ? inviteeName : inviterName;
                    createNotification(db, tx, {
                        userId: otherPlayerId,
                        fromUserId: cd.player2Id,
                        eventId,
                        eventName: meta.eventName,
                        teamId: doc.id,
                        type: "INVITATION_SUPERSEDED",
                        title: "Invitation Cancelled",
                        message: `${acceptedPlayerName} has partnered with someone else for ${meta.eventName}. Your invitation was cancelled and you are back in the Free Agent pool.`,
                        correlationId,
                    });
                } else {
                    // Scenario: A or D had invited someone else (e.g. C), but A and D have now partnered together
                    const committedPlayerName = cd.player1Id === inviterId ? inviterName : inviteeName;
                    createNotification(db, tx, {
                        userId: otherPlayerId,
                        fromUserId: cd.player1Id,
                        eventId,
                        eventName: meta.eventName,
                        teamId: doc.id,
                        type: "INVITATION_SUPERSEDED",
                        title: "Invitation No Longer Available",
                        message: `The invitation from ${committedPlayerName} for ${meta.eventName} is no longer available as they have joined another team.`,
                        correlationId,
                    });
                }

                // B. Revert the other player's registration back to Free Agent if it pointed to this team
                const otherRegSnap = otherRegMap.get(otherPlayerId);
                if (otherRegSnap && otherRegSnap.exists) {
                    const otherRegData = otherRegSnap.data();
                    if (otherRegData?.teamId === doc.id) {
                        tx.update(otherRegSnap.ref, {
                            teamId: null,
                            lookingForPartner: true,
                            partnerStatus: null,
                        });

                        createAuditLogEntry(db, tx, {
                            eventId,
                            entityType: "REGISTRATION",
                            entityId: otherRegSnap.id,
                            action: "FREE_AGENT_REVERTED",
                            actorUid: inviteeId,
                            actorName: inviteeName,
                            previousState: { status: otherRegData?.status, teamId: doc.id },
                            newState: { status: "PENDING", teamId: null, lookingForPartner: true },
                            correlationId,
                            reason: "Partner committed elsewhere; reverted to free agent",
                        });
                    }
                }
            }
        }

        createNotification(db, tx, {
            userId: inviterId,
            fromUserId: inviteeId,
            eventId,
            eventName: meta.eventName,
            teamId,
            type: "PARTNER_ACCEPTED",
            title: finalStatus === "CONFIRMED" ? "Team Confirmed!" : "Team Waitlisted",
            message: `${inviteeName} accepted your invitation! Your team is ${finalStatus === "CONFIRMED" ? "confirmed" : "on the waitlist"}.`,
            correlationId,
        });

        createNotification(db, tx, {
            userId: inviteeId,
            eventId,
            eventName: meta.eventName,
            teamId,
            type: finalStatus === "CONFIRMED" ? "REGISTRATION_CONFIRMED" : "REGISTRATION_WAITLISTED",
            title: finalStatus === "CONFIRMED" ? "Registration Confirmed" : "Added to Waitlist",
            message: `You are now ${finalStatus === "CONFIRMED" ? "confirmed" : "on the waitlist"} for ${meta.eventName}.`,
            correlationId,
        });

        return { success: true, data: { teamId, status: finalStatus } };
    });
}

// =========================================================================
// SC-04: Reject & Cancel Invitations
// =========================================================================
export async function rejectTeamInvitation(
    teamId: string,
    inviteeId: string
): Promise<ServiceResult<{ teamId: string }>> {
    const db = getAdminFirestore();

    return await db.runTransaction(async (tx) => {
        const teamRef = db.collection("teams").doc(teamId);
        const teamSnap = await tx.get(teamRef);
        if (!teamSnap.exists) return { success: false, error: "Invitation not found." };
        const teamData = teamSnap.data() || {};

        if (teamData.player2Id !== inviteeId) {
            return { success: false, error: "Unauthorized: only the invited player may reject." };
        }

        if (teamData.status !== "PENDING") {
            return { success: true, data: { teamId } }; // Idempotent
        }

        const eventId = teamData.eventId as string;
        const inviterId = teamData.player1Id as string;

        // --- READ PHASE: ALL READS BEFORE ANY WRITES ---
        const eventRef = db.collection("events").doc(eventId);
        const inviterRegRef = db.collection("registrations").doc(getRegistrationDocId(eventId, inviterId));
        const inviteeUserRef = db.collection("users").doc(inviteeId);
        const inviterUserRef = db.collection("users").doc(inviterId);

        const [eventSnap, inviterRegSnap, inviteeUserSnap, inviterUserSnap] = await Promise.all([
            tx.get(eventRef),
            tx.get(inviterRegRef),
            tx.get(inviteeUserRef),
            tx.get(inviterUserRef),
        ]);

        const eventData = eventSnap.data() || {};
        const eventName = (eventData.name || eventData.title || "the event") as string;
        const inviteeUserData = inviteeUserSnap.data() || {};
        const inviteeName = (inviteeUserData.displayName || inviteeUserData.fullName || "Your partner") as string;
        const inviterUserData = inviterUserSnap.data() || {};
        const inviterName = (inviterUserData.displayName || inviterUserData.fullName || teamData.fullNameP1 || "The inviter") as string;

        // --- WRITE PHASE ---
        const { correlationId } = createAuditLogEntry(db, tx, {
            eventId,
            entityType: "TEAM",
            entityId: teamId,
            action: "REJECTED",
            actorUid: inviteeId,
            actorName: inviteeName,
            previousState: { status: "PENDING" },
            newState: { status: "CANCELLED", cancelReason: "PARTNER_DECLINED" },
            reason: `${inviteeName} declined invitation from ${inviterName}`,
        });

        tx.update(teamRef, {
            status: "CANCELLED",
            cancelReason: "PARTNER_DECLINED",
            cancelledBy: inviteeId,
            cancelledAt: Timestamp.now(),
        });

        if (inviterRegSnap.exists && inviterRegSnap.data()?.teamId === teamId) {
            tx.update(inviterRegRef, {
                teamId: null,
                lookingForPartner: true,
                partnerStatus: null,
            });

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: inviterRegRef.id,
                action: "FREE_AGENT_REVERTED",
                actorUid: inviteeId,
                actorName: inviterName,
                previousState: { status: inviterRegSnap.data()?.status, teamId },
                newState: { status: "PENDING", teamId: null, lookingForPartner: true },
                correlationId,
                reason: `${inviteeName} declined invitation; ${inviterName} returned to free agent pool`,
            });
        }

        createNotification(db, tx, {
            userId: inviterId,
            fromUserId: inviteeId,
            eventId,
            eventName,
            teamId,
            type: "PARTNER_DECLINED",
            title: "Invitation Declined",
            message: `${inviteeName} declined your team invitation for ${eventName}. You are back in the Free Agent pool.`,
            correlationId,
        });

        return { success: true, data: { teamId } };
    });
}

export async function cancelTeamInvitation(
    teamId: string,
    inviterId: string
): Promise<ServiceResult<{ teamId: string }>> {
    const db = getAdminFirestore();

    return await db.runTransaction(async (tx) => {
        const teamRef = db.collection("teams").doc(teamId);
        const teamSnap = await tx.get(teamRef);
        if (!teamSnap.exists) return { success: false, error: "Invitation not found." };
        const teamData = teamSnap.data() || {};

        if (teamData.player1Id !== inviterId) {
            return { success: false, error: "Unauthorized: only the inviter may cancel." };
        }

        if (teamData.status !== "PENDING") {
            return { success: true, data: { teamId } }; // Idempotent
        }

        const eventId = teamData.eventId as string;
        const inviteeId = teamData.player2Id as string;
        const inviterRegId = getRegistrationDocId(eventId, inviterId);
        const inviterRegRef = db.collection("registrations").doc(inviterRegId);

        // --- READ PHASE: ALL READS BEFORE ANY WRITES ---
        const eventRef = db.collection("events").doc(eventId);
        const inviterUserRef = db.collection("users").doc(inviterId);
        const inviteeUserRef = inviteeId ? db.collection("users").doc(inviteeId) : null;
        const [inviterRegSnap, eventSnap, inviterUserSnap, inviteeUserSnap] = await Promise.all([
            tx.get(inviterRegRef),
            tx.get(eventRef),
            tx.get(inviterUserRef),
            inviteeUserRef ? tx.get(inviteeUserRef) : Promise.resolve(null),
        ]);

        const eventData = eventSnap.data() || {};
        const eventName = (eventData.name || eventData.title || "the event") as string;
        const inviterUserData = inviterUserSnap.data() || {};
        const inviterName = (inviterUserData.displayName || inviterUserData.fullName || "The inviter") as string;
        const inviteeUserData = inviteeUserSnap?.data() || {};
        const inviteeName = (inviteeUserData.displayName || inviteeUserData.fullName || teamData.fullNameP2 || "Invited player") as string;

        // --- WRITE PHASE ---
        const { correlationId } = createAuditLogEntry(db, tx, {
            eventId,
            entityType: "TEAM",
            entityId: teamId,
            action: "CANCELLED",
            actorUid: inviterId,
            actorName: inviterName,
            previousState: { status: "PENDING" },
            newState: { status: "CANCELLED", cancelReason: "INVITATION_CANCELLED_BY_INVITER" },
            reason: `${inviterName} cancelled invitation to ${inviteeName}`,
        });

        tx.update(teamRef, {
            status: "CANCELLED",
            cancelReason: "INVITATION_CANCELLED_BY_INVITER",
            cancelledBy: inviterId,
            cancelledAt: Timestamp.now(),
        });

        if (inviterRegSnap.exists && inviterRegSnap.data()?.teamId === teamId) {
            tx.update(inviterRegRef, {
                teamId: null,
                lookingForPartner: true,
                partnerStatus: null,
            });

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: inviterRegRef.id,
                action: "FREE_AGENT_REVERTED",
                actorUid: inviterId,
                actorName: inviterName,
                previousState: { status: inviterRegSnap.data()?.status, teamId },
                newState: { status: "PENDING", teamId: null, lookingForPartner: true },
                correlationId,
                reason: `${inviterName} cancelled invitation to ${inviteeName}; returned to free agent pool`,
            });
        }

        if (inviteeId) {
            createNotification(db, tx, {
                userId: inviteeId,
                fromUserId: inviterId,
                eventId,
                eventName,
                teamId,
                type: "INVITATION_CANCELLED",
                title: "Invitation Cancelled",
                message: `${inviterName} cancelled their invitation to you for ${eventName}.`,
                correlationId,
            });
        }

        return { success: true, data: { teamId } };
    });
}

// =========================================================================
// SC-08: Centralized Waitlist Promotion
// =========================================================================
interface FifoPromotionPlan {
    promotedTeamDoc: FirebaseFirestore.QueryDocumentSnapshot | null;
    disqualifiedTeamDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    r1Ref: FirebaseFirestore.DocumentReference | null;
    r2Ref: FirebaseFirestore.DocumentReference | null;
    p1Id: string | null;
    p2Id: string | null;
}

async function planFifoPromotion(
    db: FirebaseFirestore.Firestore,
    tx: FirebaseFirestore.Transaction,
    eventId: string
): Promise<FifoPromotionPlan> {
    const waitlistSnap = await tx.get(
        db.collection("teams")
            .where("eventId", "==", eventId)
            .where("status", "==", "WAITLIST")
    );
    const sortedWaitlistDocs = [...waitlistSnap.docs].sort(
        (a, b) => (a.data().waitlistSequence ?? 999999) - (b.data().waitlistSequence ?? 999999)
    );

    const disqualifiedTeamDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let promotedTeamDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let r1Ref: FirebaseFirestore.DocumentReference | null = null;
    let r2Ref: FirebaseFirestore.DocumentReference | null = null;
    let p1Id: string | null = null;
    let p2Id: string | null = null;

    for (const wDoc of sortedWaitlistDocs) {
        const wData = wDoc.data();
        const curP1Id = wData.player1Id as string;
        const curP2Id = wData.player2Id as string;

        const curR1Ref = db.collection("registrations").doc(getRegistrationDocId(eventId, curP1Id));
        const curR2Ref = db.collection("registrations").doc(getRegistrationDocId(eventId, curP2Id));

        const [u1Snap, u2Snap, r1Snap, r2Snap] = await Promise.all([
            tx.get(db.collection("users").doc(curP1Id)),
            tx.get(db.collection("users").doc(curP2Id)),
            tx.get(curR1Ref),
            tx.get(curR2Ref),
        ]);

        const u1 = u1Snap.data() || {};
        const u2 = u2Snap.data() || {};
        const r1 = r1Snap.data() || {};
        const r2 = r2Snap.data() || {};

        const e1 = evaluatePlayerEligibility(u1);
        const e2 = evaluatePlayerEligibility(u2);

        const isValid =
            e1.eligible &&
            e2.eligible &&
            r1Snap.exists &&
            r2Snap.exists &&
            r1.status === "WAITLIST" &&
            r2.status === "WAITLIST" &&
            r1.teamId === wDoc.id &&
            r2.teamId === wDoc.id;

        if (!isValid) {
            disqualifiedTeamDocs.push(wDoc);
            continue;
        }

        promotedTeamDoc = wDoc;
        r1Ref = curR1Ref;
        r2Ref = curR2Ref;
        p1Id = curP1Id;
        p2Id = curP2Id;
        break;
    }

    return {
        promotedTeamDoc,
        disqualifiedTeamDocs,
        r1Ref,
        r2Ref,
        p1Id,
        p2Id,
    };
}

function executeFifoPromotion(
    db: FirebaseFirestore.Firestore,
    tx: FirebaseFirestore.Transaction,
    eventRef: FirebaseFirestore.DocumentReference,
    eventData: Record<string, unknown>,
    meta: ReturnType<typeof normalizeEventTimes>,
    plan: FifoPromotionPlan,
    options?: { correlationId?: string; actorUid?: string; actorName?: string }
): string | undefined {
    const correlationId = options?.correlationId || `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const actorUid = options?.actorUid || "system";
    const actorName = options?.actorName || "System";

    // 1. Mark disqualified teams as CANCELLED
    for (const dDoc of plan.disqualifiedTeamDocs) {
        tx.update(dDoc.ref, {
            status: "CANCELLED",
            cancelReason: "PLAYER_INELIGIBLE",
            cancelledAt: Timestamp.now(),
        });

        createAuditLogEntry(db, tx, {
            eventId: eventRef.id,
            entityType: "TEAM",
            entityId: dDoc.id,
            action: "INELIGIBLE_FOR_PROMOTION",
            actorUid,
            actorName,
            previousState: { status: "WAITLIST" },
            newState: { status: "CANCELLED", cancelReason: "PLAYER_INELIGIBLE" },
            correlationId,
            reason: "Waitlisted team member became ineligible",
        });
    }

    // 2. Promote eligible team
    if (plan.promotedTeamDoc && plan.r1Ref && plan.r2Ref && plan.p1Id && plan.p2Id) {
        const serverNow = Timestamp.now();
        tx.update(plan.promotedTeamDoc.ref, {
            status: "CONFIRMED",
            promotedAt: serverNow,
        });

        tx.update(plan.r1Ref, {
            status: "CONFIRMED",
            confirmedAt: serverNow,
            lookingForPartner: false,
            partnerStatus: "CONFIRMED",
        });
        tx.update(plan.r2Ref, {
            status: "CONFIRMED",
            confirmedAt: serverNow,
            lookingForPartner: false,
            partnerStatus: "CONFIRMED",
        });

        createAuditLogEntry(db, tx, {
            eventId: eventRef.id,
            entityType: "TEAM",
            entityId: plan.promotedTeamDoc.id,
            action: "PROMOTED",
            actorUid,
            actorName,
            previousState: { status: "WAITLIST" },
            newState: { status: "CONFIRMED" },
            correlationId,
            reason: "Promoted from waitlist to confirmed",
        });

        createAuditLogEntry(db, tx, {
            eventId: eventRef.id,
            entityType: "REGISTRATION",
            entityId: plan.r1Ref.id,
            action: "PROMOTED",
            actorUid,
            actorName,
            previousState: { status: "WAITLIST" },
            newState: { status: "CONFIRMED" },
            correlationId,
            reason: "Promoted from waitlist to confirmed",
        });

        createAuditLogEntry(db, tx, {
            eventId: eventRef.id,
            entityType: "REGISTRATION",
            entityId: plan.r2Ref.id,
            action: "PROMOTED",
            actorUid,
            actorName,
            previousState: { status: "WAITLIST" },
            newState: { status: "CONFIRMED" },
            correlationId,
            reason: "Promoted from waitlist to confirmed",
        });

        // Decrement waitlistCount; confirmed teams count unchanged since vacated slot is filled
        tx.update(eventRef, {
            waitlistCount: Math.max(0, meta.waitlistCount - 1),
        });

        const eventId = eventRef.id;
        [plan.p1Id, plan.p2Id].forEach((uid) => {
            createNotification(db, tx, {
                userId: uid,
                eventId,
                eventName: meta.eventName,
                teamId: plan.promotedTeamDoc!.id,
                type: "WAITLIST_PROMOTED",
                title: "Promoted to Confirmed!",
                message: `Great news! Your team has been promoted from the waitlist to Confirmed for ${meta.eventName}!`,
                correlationId,
            });
        });

        return plan.promotedTeamDoc.id;
    }

    // No eligible waitlisted team found -> decrement confirmedTeamsCount
    const newConfirmedCount = Math.max(0, meta.confirmedTeamsCount - 1);
    tx.update(eventRef, {
        confirmedTeamsCount: newConfirmedCount,
        registrationsCount: newConfirmedCount,
    });
    return undefined;
}

// =========================================================================
// SC-02, SC-06, SC-07: Unified Team Withdrawal Flow (Spec v3.0)
// =========================================================================
export async function withdrawFromTeamEvent(
    eventId: string,
    playerId: string,
    options?: { confirmedLateWithdrawal?: boolean; acknowledgePenalty?: boolean; registrationId?: string }
): Promise<ServiceResult<{ action: string; redflagged?: boolean }>> {
    const db = getAdminFirestore();
    const confirmedLateWithdrawal = !!(options?.confirmedLateWithdrawal || options?.acknowledgePenalty);

    return await db.runTransaction(async (tx) => {
        const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
            return { success: false, error: "Event not found." };
        }
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventTimes(eventData);

        const regResolution = await getRegistrationRefAndDoc(db, tx, eventId, playerId, options?.registrationId);
        const regRef = regResolution.ref;
        const regSnap = regResolution.snapshot;
        const regId = regRef.id;
        const userRef = db.collection("users").doc(playerId);
        const userSnap = await tx.get(userRef);
        const regData = regResolution.data || {};
        const userData = userSnap.data() || {};
        const playerName = (regData.fullName || regData.fullNameP1 || userData.displayName || userData.fullName || "Player") as string;

        // Find active accepted team (CONFIRMED or WAITLIST)
        const teamQuery1 = await tx.get(
            db.collection("teams")
                .where("eventId", "==", eventId)
                .where("player1Id", "==", playerId)
                .where("status", "in", ["CONFIRMED", "WAITLIST"])
        );
        const teamQuery2 = await tx.get(
            db.collection("teams")
                .where("eventId", "==", eventId)
                .where("player2Id", "==", playerId)
                .where("status", "in", ["CONFIRMED", "WAITLIST"])
        );

        const activeTeamDoc = teamQuery1.docs[0] || teamQuery2.docs[0];

        // -------------------------------------------------------------
        // SC-02: FREE AGENT WITHDRAWAL (No accepted commitment)
        // -------------------------------------------------------------
        if (!activeTeamDoc) {
            // Cancel all pending proposals involving player
            const pendingQuery1 = await tx.get(
                db.collection("teams")
                    .where("eventId", "==", eventId)
                    .where("player1Id", "==", playerId)
                    .where("status", "==", "PENDING")
            );
            const pendingQuery2 = await tx.get(
                db.collection("teams")
                    .where("eventId", "==", eventId)
                    .where("player2Id", "==", playerId)
                    .where("status", "==", "PENDING")
            );

            const pendingDocs = [...pendingQuery1.docs, ...pendingQuery2.docs];
            const serverNow = Timestamp.now();
            for (const doc of pendingDocs) {
                tx.update(doc.ref, {
                    status: "CANCELLED",
                    cancelReason: "PARTNER_WITHDRAWN",
                    cancelledBy: playerId,
                    cancelledAt: serverNow,
                });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "TEAM",
                    entityId: doc.id,
                    action: "CANCELLED",
                    actorUid: playerId,
                    actorName: playerName,
                    previousState: { status: "PENDING" },
                    newState: { status: "CANCELLED", cancelReason: "PARTNER_WITHDRAWN" },
                    correlationId,
                    reason: `Pending invitation cancelled due to ${playerName} withdrawing`,
                });
            }

            if (regSnap.exists) {
                tx.update(regRef, {
                    status: "CANCELLED",
                    teamId: null,
                    withdrawnAt: serverNow,
                    cancelledAt: serverNow,
                    cancelReason: "PLAYER_WITHDREW",
                });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "REGISTRATION",
                    entityId: regId,
                    action: "WITHDRAWN",
                    actorUid: playerId,
                    actorName: playerName,
                    previousState: { status: regSnap.data()?.status || "PENDING", teamId: null },
                    newState: { status: "CANCELLED", teamId: null },
                    correlationId,
                    reason: `${playerName} withdrew from free agent pool`,
                });
            }

            // Free agent withdrawal NEVER triggers late withdrawal penalty
            return {
                success: true,
                data: { action: "FREE_AGENT_WITHDRAWN", redflagged: false },
            };
        }

        const teamData = activeTeamDoc.data();
        const teamRef = activeTeamDoc.ref;
        const initialStatus = teamData.status as "CONFIRMED" | "WAITLIST";
        const isPlayer1 = teamData.player1Id === playerId;
        const otherPlayerId = isPlayer1 ? (teamData.player2Id as string) : (teamData.player1Id as string);
        const otherPlayerName = (isPlayer1 ? teamData.fullNameP2 : teamData.fullNameP1) || "Partner";
        const serverNow = Timestamp.now();

        // -------------------------------------------------------------
        // SC-07: WAITLIST TEAM MEMBER WITHDRAWAL
        // -------------------------------------------------------------
        if (initialStatus === "WAITLIST") {
            tx.update(teamRef, {
                status: "CANCELLED",
                cancelReason: "WAITLIST_WITHDRAWN",
                cancelledBy: playerId,
                cancelledAt: serverNow,
            });

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "TEAM",
                entityId: teamRef.id,
                action: "WITHDRAWN",
                actorUid: playerId,
                actorName: playerName,
                previousState: { status: "WAITLIST" },
                newState: { status: "CANCELLED", cancelReason: "WAITLIST_WITHDRAWN" },
                correlationId,
                reason: `${playerName} withdrew from waitlisted team`,
            });

            // Withdrawing player -> CANCELLED
            tx.set(
                regRef,
                {
                    status: "CANCELLED",
                    teamId: null,
                    withdrawnAt: serverNow,
                    cancelledAt: serverNow,
                    cancelReason: "WAITLIST_WITHDRAWN",
                },
                { merge: true }
            );

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: regId,
                action: "WITHDRAWN",
                actorUid: playerId,
                actorName: playerName,
                previousState: { status: "WAITLIST", teamId: teamRef.id },
                newState: { status: "CANCELLED", teamId: null },
                correlationId,
                reason: `${playerName} withdrew from waitlisted team`,
            });

            // Teammate -> PENDING Free Agent (never penalized)
            if (otherPlayerId) {
                const otherRegRef = db.collection("registrations").doc(getRegistrationDocId(eventId, otherPlayerId));
                tx.set(
                    otherRegRef,
                    {
                        status: "PENDING",
                        teamId: null,
                        lookingForPartner: true,
                        partnerStatus: null,
                    },
                    { merge: true }
                );

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "REGISTRATION",
                    entityId: otherRegRef.id,
                    action: "FREE_AGENT_REVERTED",
                    actorUid: playerId,
                    actorName: otherPlayerName,
                    previousState: { status: "WAITLIST", teamId: teamRef.id },
                    newState: { status: "PENDING", teamId: null, lookingForPartner: true },
                    correlationId,
                    reason: `${playerName} withdrew from waitlist; ${otherPlayerName} returned to free agent pool`,
                });

                createNotification(db, tx, {
                    userId: otherPlayerId,
                    fromUserId: playerId,
                    eventId,
                    eventName: meta.eventName,
                    type: "TEAM_CANCELLED",
                    title: "Teammate Withdrew",
                    message: "Your partner withdrew from the waitlist team. You have returned to the Free Agent pool.",
                    correlationId,
                });
            }

            tx.update(eventRef, {
                waitlistCount: Math.max(0, meta.waitlistCount - 1),
            });

            // Waitlist withdrawal NEVER triggers red-flag
            return {
                success: true,
                data: { action: "WAITLIST_WITHDRAWN", redflagged: false },
            };
        }

        // -------------------------------------------------------------
        // SC-06: CONFIRMED TEAM MEMBER WITHDRAWAL (Tiered 18h/12h Window)
        // -------------------------------------------------------------
        const lateEval = calculateLateWithdrawalWindow(meta.eventStartAt, meta.timeZone);

        if (lateEval.isLate && !confirmedLateWithdrawal) {
            return {
                success: false,
                requiresConfirmation: true,
                isLate: true,
                warningMessage:
                    `This withdrawal is within the final ${lateEval.thresholdHours} hours before the event. ` +
                    "Continuing will withdraw you and mark your account red-flagged. " +
                    "Your teammate will return to the Free Agent pool without penalty.",
            };
        }

        // READ PHASE: Plan FIFO waitlist promotion before writing
        const promoPlan = await planFifoPromotion(db, tx, eventId);

        // WRITE PHASE:
        // 1. Team dissolves immediately -> CANCELLED
        tx.update(teamRef, {
            status: "CANCELLED",
            cancelReason: lateEval.isLate ? "LATE_WITHDRAWAL" : "MEMBER_WITHDRAWN",
            cancelledBy: playerId,
            cancelledAt: serverNow,
        });

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "TEAM",
            entityId: teamRef.id,
            action: "WITHDRAWN",
            actorUid: playerId,
            actorName: playerName,
            previousState: { status: "CONFIRMED" },
            newState: { status: "CANCELLED", cancelReason: lateEval.isLate ? "LATE_WITHDRAWAL" : "MEMBER_WITHDRAWN" },
            correlationId,
            reason: lateEval.isLate ? `${playerName} confirmed late withdrawal` : `${playerName} confirmed standard withdrawal`,
        });

        // 2. Withdrawing player -> CANCELLED
        tx.set(
            regRef,
            {
                status: "CANCELLED",
                teamId: null,
                withdrawnAt: serverNow,
                cancelledAt: serverNow,
                cancelReason: lateEval.isLate ? "LATE_WITHDRAWAL" : "MEMBER_WITHDRAWN",
            },
            { merge: true }
        );

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "REGISTRATION",
            entityId: regId,
            action: "WITHDRAWN",
            actorUid: playerId,
            actorName: playerName,
            previousState: { status: "CONFIRMED", teamId: teamRef.id },
            newState: { status: "CANCELLED", teamId: null },
            correlationId,
            reason: lateEval.isLate ? `${playerName} confirmed late withdrawal` : `${playerName} confirmed standard withdrawal`,
        });

        // If late -> Red-flag initiating player ONLY
        if (lateEval.isLate) {
            const userRef = db.collection("users").doc(playerId);
            tx.update(userRef, {
                redflagged: true,
                redflaggedAt: serverNow,
                redflagReason: "LATE_WITHDRAWAL",
                redflagEventId: eventId,
            });
        }

        // 3. Remaining player (NEVER penalized) -> PENDING Free Agent
        if (otherPlayerId) {
            const otherRegRef = db.collection("registrations").doc(getRegistrationDocId(eventId, otherPlayerId));
            tx.set(
                otherRegRef,
                {
                    status: "PENDING",
                    teamId: null,
                    lookingForPartner: true,
                    partnerStatus: null,
                },
                { merge: true }
            );

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: otherRegRef.id,
                action: "FREE_AGENT_REVERTED",
                actorUid: playerId,
                actorName: otherPlayerName,
                previousState: { status: "CONFIRMED", teamId: teamRef.id },
                newState: { status: "PENDING", teamId: null, lookingForPartner: true },
                correlationId,
                reason: lateEval.isLate
                    ? `${playerName} withdrew late; ${otherPlayerName} returned to free agent pool`
                    : `${playerName} withdrew; ${otherPlayerName} returned to free agent pool`,
            });

            createNotification(db, tx, {
                userId: otherPlayerId,
                fromUserId: playerId,
                eventId,
                eventName: meta.eventName,
                type: "TEAM_CANCELLED",
                title: "Teammate Withdrew",
                message: "Your partner withdrew from the confirmed team. You have returned to the Free Agent pool.",
                correlationId,
            });
        }

        // 4. Centralized waitlist promotion (SC-08)
        executeFifoPromotion(db, tx, eventRef, eventData, meta, promoPlan, {
            correlationId,
            actorUid: playerId,
        });

        return {
            success: true,
            data: {
                action: lateEval.isLate ? "LATE_WITHDRAWAL_CONFIRMED" : "CONFIRMED_WITHDRAWN",
                redflagged: lateEval.isLate,
            },
        };
    });
}

// =========================================================================
// SC-09: Admin Capacity Changes (Spec v3.0)
// =========================================================================
export async function adjustTeamEventCapacity(
    eventId: string,
    newSlotsAvailable: number
): Promise<ServiceResult<{ eventId: string; newSlotsAvailable: number }>> {
    if (newSlotsAvailable < 0) return { success: false, error: "Slots cannot be negative." };

    const db = getAdminFirestore();

    return await db.runTransaction(async (tx) => {
        const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) return { success: false, error: "Event not found." };
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventTimes(eventData);

        const currentSlots = meta.slotsAvailable;
        const currentConfirmed = meta.confirmedTeamsCount;

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "EVENT",
            entityId: eventId,
            action: "CAPACITY_CHANGED",
            actorUid: "admin",
            previousState: { slotsAvailable: currentSlots },
            newState: { slotsAvailable: newSlotsAvailable },
            correlationId,
            reason: `Admin changed capacity from ${currentSlots} to ${newSlotsAvailable}`,
        });

        // Capacity Increase: Promote FIFO up to (newSlots - currentConfirmed)
        if (newSlotsAvailable > currentSlots) {
            const availableSlots = newSlotsAvailable - currentConfirmed;
            const teamsToPromote: Array<{
                teamDoc: FirebaseFirestore.QueryDocumentSnapshot;
                p1Id: string;
                p2Id: string;
                r1Ref: FirebaseFirestore.DocumentReference;
                r2Ref: FirebaseFirestore.DocumentReference;
            }> = [];
            const ineligibleTeams: FirebaseFirestore.QueryDocumentSnapshot[] = [];

            if (availableSlots > 0 && meta.waitlistCount > 0) {
                const waitlistSnap = await tx.get(
                    db.collection("teams")
                        .where("eventId", "==", eventId)
                        .where("status", "==", "WAITLIST")
                );
                const sortedWaitlistDocs = [...waitlistSnap.docs].sort(
                    (a, b) => (a.data().waitlistSequence ?? 999999) - (b.data().waitlistSequence ?? 999999)
                );

                for (const wDoc of sortedWaitlistDocs) {
                    if (teamsToPromote.length >= availableSlots) break;
                    const wData = wDoc.data();
                    const p1Id = wData.player1Id as string;
                    const p2Id = wData.player2Id as string;

                    const [u1Snap, u2Snap] = await Promise.all([
                        tx.get(db.collection("users").doc(p1Id)),
                        tx.get(db.collection("users").doc(p2Id)),
                    ]);

                    const e1 = evaluatePlayerEligibility(u1Snap.data());
                    const e2 = evaluatePlayerEligibility(u2Snap.data());

                    if (!e1.eligible || !e2.eligible) {
                        ineligibleTeams.push(wDoc);
                        continue;
                    }

                    const r1Ref = db.collection("registrations").doc(getRegistrationDocId(eventId, p1Id));
                    const r2Ref = db.collection("registrations").doc(getRegistrationDocId(eventId, p2Id));
                    teamsToPromote.push({ teamDoc: wDoc, p1Id, p2Id, r1Ref, r2Ref });
                }
            }

            for (const inDoc of ineligibleTeams) {
                tx.update(inDoc.ref, {
                    status: "CANCELLED",
                    cancelReason: "PLAYER_INELIGIBLE",
                    cancelledAt: Timestamp.now(),
                });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "TEAM",
                    entityId: inDoc.id,
                    action: "INELIGIBLE_FOR_PROMOTION",
                    actorUid: "admin",
                    previousState: { status: "WAITLIST" },
                    newState: { status: "CANCELLED", cancelReason: "PLAYER_INELIGIBLE" },
                    correlationId,
                    reason: "Ineligible player disqualified during capacity increase promotion",
                });
            }

            let newConfirmedCount = currentConfirmed;
            let newWaitlistCount = meta.waitlistCount;
            const serverNow = Timestamp.now();

            for (const item of teamsToPromote) {
                tx.update(item.teamDoc.ref, {
                    status: "CONFIRMED",
                    promotedAt: serverNow,
                });

                tx.update(item.r1Ref, { status: "CONFIRMED", confirmedAt: serverNow, lookingForPartner: false, partnerStatus: "CONFIRMED" });
                tx.update(item.r2Ref, { status: "CONFIRMED", confirmedAt: serverNow, lookingForPartner: false, partnerStatus: "CONFIRMED" });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "TEAM",
                    entityId: item.teamDoc.id,
                    action: "PROMOTED",
                    actorUid: "admin",
                    previousState: { status: "WAITLIST" },
                    newState: { status: "CONFIRMED" },
                    correlationId,
                    reason: "Promoted due to capacity increase",
                });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "REGISTRATION",
                    entityId: item.r1Ref.id,
                    action: "PROMOTED",
                    actorUid: "admin",
                    previousState: { status: "WAITLIST" },
                    newState: { status: "CONFIRMED" },
                    correlationId,
                    reason: "Promoted due to capacity increase",
                });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "REGISTRATION",
                    entityId: item.r2Ref.id,
                    action: "PROMOTED",
                    actorUid: "admin",
                    previousState: { status: "WAITLIST" },
                    newState: { status: "CONFIRMED" },
                    correlationId,
                    reason: "Promoted due to capacity increase",
                });

                newConfirmedCount++;
                newWaitlistCount--;

                [item.p1Id, item.p2Id].forEach((uid) => {
                    createNotification(db, tx, {
                        userId: uid,
                        eventId,
                        eventName: meta.eventName,
                        teamId: item.teamDoc.id,
                        type: "WAITLIST_PROMOTED",
                        title: "Promoted to Confirmed!",
                        message: `Capacity was increased! Your team has been promoted to Confirmed for ${meta.eventName}!`,
                        correlationId,
                    });
                });
            }

            tx.update(eventRef, {
                slotsAvailable: newSlotsAvailable,
                maxPlayers: newSlotsAvailable,
                confirmedTeamsCount: newConfirmedCount,
                registrationsCount: newConfirmedCount,
                waitlistCount: Math.max(0, newWaitlistCount),
            });

            return { success: true, data: { eventId, newSlotsAvailable } };
        }

        // Capacity Decrease: Demote most recently confirmed teams (reverse acceptedAt order)
        if (newSlotsAvailable < currentSlots) {
            const excess = currentConfirmed - newSlotsAvailable;
            if (excess <= 0) {
                tx.update(eventRef, { slotsAvailable: newSlotsAvailable, maxPlayers: newSlotsAvailable });
                return { success: true, data: { eventId, newSlotsAvailable } };
            }

            // Query most recently confirmed intact teams
            const confirmedTeamsSnap = await tx.get(
                db.collection("teams")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "CONFIRMED")
                    .orderBy("acceptedAt", "desc")
                    .limit(excess)
            );

            let nextSeq = meta.nextWaitlistSeq;
            const serverNow = Timestamp.now();

            for (const teamDoc of confirmedTeamsSnap.docs) {
                const td = teamDoc.data();
                const p1 = td.player1Id as string;
                const p2 = td.player2Id as string;

                tx.update(teamDoc.ref, {
                    status: "WAITLIST",
                    waitlistSequence: nextSeq,
                });

                const r1Ref = db.collection("registrations").doc(getRegistrationDocId(eventId, p1));
                const r2Ref = db.collection("registrations").doc(getRegistrationDocId(eventId, p2));
                tx.update(r1Ref, { status: "WAITLIST", waitlistSequence: nextSeq, confirmedAt: null });
                tx.update(r2Ref, { status: "WAITLIST", waitlistSequence: nextSeq, confirmedAt: null });

                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "TEAM",
                    entityId: teamDoc.id,
                    action: "DEMOTED",
                    actorUid: "admin",
                    previousState: { status: "CONFIRMED" },
                    newState: { status: "WAITLIST", waitlistSequence: nextSeq },
                    correlationId,
                    reason: "Demoted to waitlist due to capacity reduction",
                });

                [p1, p2].forEach((uid) => {
                    createNotification(db, tx, {
                        userId: uid,
                        eventId,
                        eventName: meta.eventName,
                        teamId: teamDoc.id,
                        type: "WAITLIST_DEMOTED",
                        title: "Moved to Waitlist",
                        message: `Due to a capacity reduction, your team was moved to the waitlist for ${meta.eventName}.`,
                        correlationId,
                    });
                });

                nextSeq++;
            }

            tx.update(eventRef, {
                slotsAvailable: newSlotsAvailable,
                maxPlayers: newSlotsAvailable,
                confirmedTeamsCount: newSlotsAvailable,
                registrationsCount: newSlotsAvailable,
                waitlistCount: meta.waitlistCount + excess,
                nextWaitlistSeq: nextSeq,
            });

            return { success: true, data: { eventId, newSlotsAvailable } };
        }

        return { success: true, data: { eventId, newSlotsAvailable } };
    });
}

// =========================================================================
// SC-10: Admin Event Cancellation (Spec v3.0)
// =========================================================================
export async function cancelTeamEvent(
    eventId: string,
    cancellationMessage?: string
): Promise<ServiceResult<{ eventId: string }>> {
    const db = getAdminFirestore();

    const eventRef = db.collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return { success: false, error: "Event not found." };
    const eventData = eventSnap.data() || {};
    const meta = normalizeEventTimes(eventData);

    if (eventData.eventStatus === "CANCELLED" || eventData.status === "Cancelled") {
        return { success: true, data: { eventId } }; // Idempotent
    }

    const serverNow = Timestamp.now();

    // 1. Cancel the event doc
    await eventRef.update({
        eventStatus: "CANCELLED",
        status: "Cancelled",
        cancellationMessage: cancellationMessage || "Event cancelled by administrator.",
        confirmedTeamsCount: 0,
        registrationsCount: 0,
        waitlistCount: 0,
    });

    // 2. Cancel all active teams (PENDING, CONFIRMED, WAITLIST)
    const teamsSnap = await db.collection("teams").where("eventId", "==", eventId).get();
    const activeTeams = teamsSnap.docs.filter((d) =>
        ["PENDING", "CONFIRMED", "WAITLIST"].includes(d.data().status)
    );

    const committedPlayerIds = new Set<string>();

    let batch = db.batch();
    let opCount = 0;

    for (const tDoc of activeTeams) {
        const td = tDoc.data();
        if (td.status === "CONFIRMED" || td.status === "WAITLIST") {
            if (td.player1Id) committedPlayerIds.add(td.player1Id);
            if (td.player2Id) committedPlayerIds.add(td.player2Id);
        }

        batch.update(tDoc.ref, {
            status: "CANCELLED",
            cancelReason: "EVENT_CANCELLED",
            cancelledAt: serverNow,
        });
        opCount++;

        if (opCount >= 400) {
            await batch.commit();
            batch = db.batch();
            opCount = 0;
        }
    }

    // 3. Update all registrations for this event to CANCELLED
    const regsSnap = await db.collection("registrations").where("eventId", "==", eventId).get();
    for (const rDoc of regsSnap.docs) {
        if (rDoc.data().status !== "CANCELLED") {
            batch.update(rDoc.ref, {
                status: "CANCELLED",
                teamId: null,
                cancelledAt: serverNow,
                cancelReason: "EVENT_CANCELLED",
            });
            opCount++;
            if (opCount >= 400) {
                await batch.commit();
                batch = db.batch();
                opCount = 0;
            }
        }
    }

    if (opCount > 0) {
        await batch.commit();
    }

    // 4. Notify all players in CONFIRMED or WAITLIST teams
    for (const uid of committedPlayerIds) {
        createNotification(db, db.batch(), {
            userId: uid,
            eventId,
            eventName: meta.eventName,
            type: "EVENT_CANCELLED",
            title: "Event Cancelled",
            message: `The event "${meta.eventName}" has been cancelled by an administrator.`,
        });
    }

    return { success: true, data: { eventId } };
}

// =========================================================================
// SC-04 & SC-11: Expire Standard Invitations (Worker or Lazy)
// =========================================================================
export async function expireStandardInvitationsForEvent(
    eventId: string
): Promise<ServiceResult<{ expiredCount: number }>> {
    const db = getAdminFirestore();
    const now = new Date();

    const pendingSnap = await db
        .collection("teams")
        .where("eventId", "==", eventId)
        .where("status", "==", "PENDING")
        .get();

    let expiredCount = 0;
    const batch = db.batch();

    for (const doc of pendingSnap.docs) {
        const data = doc.data();
        const expiresAt = data.invitationExpiresAt?.toDate();
        if (expiresAt && now >= expiresAt) {
            batch.update(doc.ref, {
                status: "EXPIRED",
                cancelReason: "INVITATION_EXPIRED",
                cancelledAt: Timestamp.now(),
            });
            expiredCount++;
        }
    }

    if (expiredCount > 0) {
        await batch.commit();
    }

    return { success: true, data: { expiredCount } };
}

// =========================================================================
// SC-13: Admin Clear Red-Flag
// =========================================================================
export async function clearPlayerRedFlag(
    targetUid: string
): Promise<ServiceResult<{ targetUid: string }>> {
    const db = getAdminFirestore();
    const userRef = db.collection("users").doc(targetUid);

    await userRef.update({
        redflagged: false,
        redflaggedAt: null,
        redflagReason: null,
        redflagEventId: null,
    });

    return { success: true, data: { targetUid } };
}

// Deprecated V2 replacement methods stubbed to satisfy existing imports without crashing
export async function inviteReplacementPartner(..._args: any[]): Promise<ServiceResult<{ teamId: string }>> {
    return { success: false, error: "Replacement grace period is superseded in v3.0 specification." };
}
export async function cancelReplacementInvite(..._args: any[]): Promise<ServiceResult<{ teamId: string }>> {
    return { success: false, error: "Replacement grace period is superseded in v3.0 specification." };
}
export async function acceptReplacementPartner(..._args: any[]): Promise<ServiceResult<{ teamId: string }>> {
    return { success: false, error: "Replacement grace period is superseded in v3.0 specification." };
}
export async function processGracePeriodExpiry(..._args: any[]): Promise<ServiceResult<{ expiredCount: number }>> {
    return { success: true, data: { expiredCount: 0 } };
}
export async function expireGraceTeamsForEvent(..._args: any[]): Promise<ServiceResult<{ expiredCount: number }>> {
    return { success: true, data: { expiredCount: 0 } };
}
