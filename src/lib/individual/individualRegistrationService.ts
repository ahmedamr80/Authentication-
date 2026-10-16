import { getAdminFirestore } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
    calculateLateWithdrawalWindow,
    getRegistrationDocId,
    getRegistrationRefAndDoc,
    evaluatePlayerEligibility,
    resolvePlayerEligibilityWithAuth,
    normalizeEventDoc,
    appendAuditEntry,
    createNotificationDoc,
} from "@/lib/events/registrationUtils";
import { createAuditLogEntry } from "@/lib/events/auditLogService";

export interface ServiceResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    requiresConfirmation?: boolean;
    requiresAcknowledgment?: boolean;
    isLate?: boolean;
    warningMessage?: string;
    message?: string;
}

// =========================================================================
// SC-01: Individual Player Register or Re-register
// =========================================================================
export async function registerIndividualPlayer(
    eventId: string,
    playerId: string,
    callerAuth?: { emailVerified?: boolean; phoneNumber?: string } | null
): Promise<ServiceResult<{ registrationId: string; status: "CONFIRMED" | "WAITLIST" }>> {
    const db = getAdminFirestore();
    const now = new Date();

    const initialUserSnap = await db.collection("users").doc(playerId).get();
    const resolvedAuth = await resolvePlayerEligibilityWithAuth(initialUserSnap.data(), playerId, callerAuth);
    if (!resolvedAuth.eligible) {
        return { success: false, error: resolvedAuth.message };
    }

    if (resolvedAuth.shouldSyncEmail) {
        db.collection("users").doc(playerId).set({ emailVerified: true }, { merge: true }).catch(() => {});
    }

    let triggerWorker = false;
    let notificationPayload: {
        type: string;
        title: string;
        message: string;
        eventName: string;
    } | null = null;

    const result = await db.runTransaction(async (tx) => {
        // 1. Transactional Reads
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
            return { success: false, error: "Event not found." };
        }
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventDoc(eventData);

        if (meta.unitType !== "players") {
            return { success: false, error: "This event is configured for teams, not individual players." };
        }
        if (meta.status === "CANCELLED") {
            return { success: false, error: "Cannot register for a cancelled event." };
        }
        if (meta.status !== "UPCOMING" || now >= meta.dateTime) {
            return { success: false, error: "Registration is closed for this event." };
        }
        if (meta.capacityChangeInProgress) {
            return { success: false, error: "Capacity adjustment in progress. Please retry shortly." };
        }

        // Eligibility Check
        const userRef = db.collection("users").doc(playerId);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const eligibility = evaluatePlayerEligibility(userData, resolvedAuth.authRecord);
        if (!eligibility.eligible) {
            return { success: false, error: eligibility.message };
        }

        const playerName = (userData.displayName || userData.fullName || userData.fullname || "Player") as string;
        const regResolution = await getRegistrationRefAndDoc(db, tx, eventId, playerId);
        const regRef = regResolution.ref;
        const regSnap = regResolution.snapshot;
        const regId = regRef.id;

        const serverNow = Timestamp.now();
        let isReRegistration = false;
        let previousStatus: string | null = null;

        if (regResolution.exists) {
            const regData = regResolution.data || {};
            previousStatus = (regData.status as string) || null;
            // Rule: Repeated requests must return current state without double-updating counters
            if (regData.status === "CONFIRMED" || regData.status === "WAITLIST") {
                return {
                    success: true,
                    data: { registrationId: regId, status: regData.status as "CONFIRMED" | "WAITLIST" },
                };
            }
            isReRegistration = true;
        }

        // 2. Capacity Decision
        // Fast-path: If waitlistCount > 0, new registrant CANNOT bypass existing waitlist!
        let newStatus: "CONFIRMED" | "WAITLIST";
        if (meta.waitlistCount > 0) {
            newStatus = "WAITLIST";
            triggerWorker = true; // Attempt promotion if there is open confirmed capacity
        } else if (meta.registrationsCount < meta.slotsAvailable) {
            newStatus = "CONFIRMED";
        } else {
            newStatus = "WAITLIST";
        }

        // 3. Transactional Writes
        const regPayload = {
            registrationId: regId,
            eventId,
            playerId,
            fullName: playerName,
            fullNameP1: playerName,
            status: newStatus,
            registeredAt: serverNow,
            confirmedAt: newStatus === "CONFIRMED" ? serverNow : null,
            waitlistedAt: newStatus === "WAITLIST" ? serverNow : null,
            withdrawnAt: null,
            cancelledAt: null,
            cancelReason: null,
        };

        tx.set(regRef, regPayload, { merge: true });

        // Update event counters
        if (newStatus === "CONFIRMED") {
            tx.update(eventRef, {
                registrationsCount: meta.registrationsCount + 1,
            });
        } else {
            tx.update(eventRef, {
                waitlistCount: meta.waitlistCount + 1,
            });
        }

        // Append audit trail
        appendAuditEntry(db, tx, eventId, playerId, {
            action: isReRegistration ? "RE_REGISTRATION" : "REGISTRATION",
            previousStatus,
            newStatus,
            timestamp: serverNow,
        });

        createAuditLogEntry(db, tx, {
            eventId,
            entityType: "REGISTRATION",
            entityId: regId,
            action: "REGISTERED",
            actorUid: playerId,
            actorName: playerName,
            previousState: { status: previousStatus },
            newState: { status: newStatus },
            timestamp: serverNow,
        });

        // Prepare post-commit notification
        const isWait = newStatus === "WAITLIST";
        notificationPayload = {
            type: isWait ? "REGISTRATION_WAITLISTED" : "REGISTRATION_CONFIRMED",
            title: isWait ? "Added to Waitlist" : "Registration Confirmed",
            message: isWait
                ? `You have joined the waitlist for ${meta.eventName}. You will be notified automatically if a spot opens up.`
                : `Your registration for ${meta.eventName} is confirmed!`,
            eventName: meta.eventName,
        };

        return {
            success: true,
            data: { registrationId: regId, status: newStatus },
            notificationPayload,
            triggerWorker,
        };
    });

    if (result.success && result.notificationPayload) {
        // Send notification post-commit
        createNotificationDoc(db, db.batch(), {
            userId: playerId,
            eventId,
            eventName: result.notificationPayload.eventName,
            type: result.notificationPayload.type,
            title: result.notificationPayload.title,
            message: result.notificationPayload.message,
        });

        if (result.triggerWorker) {
            // Asynchronously run waitlist promotion worker
            runIndividualWaitlistPromotionWorker(eventId).catch((e) =>
                console.warn("[WaitlistWorker] Non-blocking worker error:", e)
            );
        }
    }

    return result;
}

// =========================================================================
// SC-02 & SC-03: Confirmed / Waitlisted Individual Player Withdrawal
// =========================================================================
export async function withdrawIndividualPlayer(
    eventId: string,
    playerId: string,
    options?: { acknowledgePenalty?: boolean; confirmedLateWithdrawal?: boolean; registrationId?: string }
): Promise<ServiceResult<{ action: string; redflagged?: boolean }>> {
    const db = getAdminFirestore();
    const now = new Date();
    const acknowledgePenalty = !!(options?.acknowledgePenalty || options?.confirmedLateWithdrawal);

    let triggerWorker = false;
    let notificationPayload: { eventName: string; correlationId: string } | null = null;
    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const result = await db.runTransaction(async (tx) => {
        // 1. Transactional Reads
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
            return { success: false, error: "Event not found." };
        }
        const eventData = eventSnap.data() || {};
        const meta = normalizeEventDoc(eventData);

        if (meta.status !== "UPCOMING" || now >= meta.dateTime) {
            return { success: false, error: "Withdrawals are closed once the event has started or concluded." };
        }
        if (meta.capacityChangeInProgress) {
            return { success: false, error: "Capacity adjustment in progress. Please retry shortly." };
        }

        const regResolution = await getRegistrationRefAndDoc(db, tx, eventId, playerId, options?.registrationId);

        if (!regResolution.exists) {
            return { success: false, error: "No registration found for this event." };
        }

        const regRef = regResolution.ref;
        const regSnap = regResolution.snapshot;
        const regId = regRef.id;
        const regData = regResolution.data || {};
        const currentStatus = regData.status as string;

        // Idempotency: Already cancelled
        if (currentStatus === "CANCELLED") {
            return {
                success: true,
                data: { action: "ALREADY_WITHDRAWN", redflagged: false },
            };
        }

        const serverNow = Timestamp.now();
        const playerName = (regData.fullName || regData.fullNameP1 || regData.playerDisplayName || "Player") as string;

        // ---------------------------------------------------------------------
        // SC-03: Waitlisted Player Withdraws (NEVER penalized or warned)
        // ---------------------------------------------------------------------
        if (currentStatus === "WAITLIST") {
            tx.update(regRef, {
                status: "CANCELLED",
                teamId: null,
                waitlistedAt: null,
                waitlistPosition: null,
                waitlistSequence: null,
                withdrawnAt: serverNow,
                cancelledAt: serverNow,
                cancelReason: "PLAYER_WITHDREW_FROM_WAITLIST",
            });

            if (regData.teamId) {
                tx.update(db.collection("teams").doc(regData.teamId), {
                    status: "CANCELLED",
                    cancelledAt: serverNow,
                    cancelledBy: playerId,
                    cancelReason: "PLAYER_WITHDREW_FROM_WAITLIST",
                });
            }

            tx.update(eventRef, {
                waitlistCount: Math.max(0, meta.waitlistCount - 1),
            });

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: regId,
                action: "WITHDRAWN",
                actorUid: playerId,
                actorName: playerName,
                previousState: { status: "WAITLIST" },
                newState: { status: "CANCELLED" },
                correlationId,
                reason: `${playerName} withdrew from waitlist`,
                timestamp: serverNow,
            });

            notificationPayload = { eventName: meta.eventName, correlationId };

            return {
                success: true,
                data: { action: "WAITLIST_WITHDRAWN", redflagged: false },
            };
        }

        // ---------------------------------------------------------------------
        // SC-02: Confirmed Player Withdraws
        // ---------------------------------------------------------------------
        if (currentStatus === "CONFIRMED") {
            // Evaluate late withdrawal threshold per Section 2.5
            const lateEval = calculateLateWithdrawalWindow(meta.dateTime, meta.timeZone);

            if (lateEval.isLate && !acknowledgePenalty) {
                return {
                    success: false,
                    requiresConfirmation: true,
                    requiresAcknowledgment: true,
                    isLate: true,
                    error: "LATE_WITHDRAWAL_WARNING",
                    message:
                        `This withdrawal is within the final ${lateEval.thresholdHours} hours before the event start. ` +
                        "Continuing will withdraw you and mark your account red-flagged.",
                };
            }

            // Execute withdrawal
            tx.update(regRef, {
                status: "CANCELLED",
                teamId: null,
                confirmedAt: null,
                withdrawnAt: serverNow,
                cancelledAt: serverNow,
                cancelReason: lateEval.isLate ? "LATE_WITHDRAWAL" : "PLAYER_WITHDREW",
            });

            if (regData.teamId) {
                tx.update(db.collection("teams").doc(regData.teamId), {
                    status: "CANCELLED",
                    cancelledAt: serverNow,
                    cancelledBy: playerId,
                    cancelReason: lateEval.isLate ? "LATE_WITHDRAWAL" : "PLAYER_WITHDREW",
                });
            }

            tx.update(eventRef, {
                registrationsCount: Math.max(0, meta.registrationsCount - 1),
            });

            if (lateEval.isLate) {
                // Red-flag initiating player
                const userRef = db.collection("users").doc(playerId);
                tx.update(userRef, {
                    redflagged: true,
                    redflaggedAt: serverNow,
                    redflagReason: "LATE_WITHDRAWAL",
                    redflagEventId: eventId,
                });
            }

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: regId,
                action: "WITHDRAWN",
                actorUid: playerId,
                actorName: playerName,
                previousState: { status: "CONFIRMED" },
                newState: { status: "CANCELLED" },
                correlationId,
                reason: lateEval.isLate ? `${playerName} confirmed late withdrawal` : `${playerName} confirmed standard withdrawal`,
                timestamp: serverNow,
            });

            triggerWorker = true;
            notificationPayload = { eventName: meta.eventName, correlationId };

            return {
                success: true,
                data: {
                    action: lateEval.isLate ? "LATE_WITHDRAWAL_CONFIRMED" : "CONFIRMED_WITHDRAWN",
                    redflagged: lateEval.isLate,
                },
                notificationPayload,
                triggerWorker,
                correlationId,
            };
        }

        // SC-04: Pending / Free Agent Player Withdraws (NEVER penalized or warned)
        if (currentStatus === "PENDING") {
            tx.update(regRef, {
                status: "CANCELLED",
                teamId: null,
                withdrawnAt: serverNow,
                cancelledAt: serverNow,
                cancelReason: "PLAYER_WITHDREW_FROM_PENDING",
            });

            if (regData.teamId) {
                tx.update(db.collection("teams").doc(regData.teamId), {
                    status: "CANCELLED",
                    cancelledAt: serverNow,
                    cancelledBy: playerId,
                    cancelReason: "PLAYER_WITHDREW_FROM_PENDING",
                });
            }

            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: regId,
                action: "WITHDRAWN",
                actorUid: playerId,
                actorName: playerName,
                previousState: { status: "PENDING" },
                newState: { status: "CANCELLED" },
                correlationId,
                reason: `${playerName} withdrew from free agent pool`,
                timestamp: serverNow,
            });

            notificationPayload = { eventName: meta.eventName, correlationId };

            return {
                success: true,
                data: { action: "PENDING_WITHDRAWN", redflagged: false },
            };
        }

        return { success: false, error: `Invalid registration status: ${currentStatus}` };
    });

    if (result.success && result.notificationPayload) {
        // Send post-commit notification with correlationId
        createNotificationDoc(db, db.batch(), {
            userId: playerId,
            eventId,
            eventName: result.notificationPayload.eventName,
            type: "REGISTRATION_WITHDRAWN",
            title: "Registration Withdrawn",
            message: `You have successfully withdrawn from ${result.notificationPayload.eventName}.`,
            correlationId: result.notificationPayload.correlationId,
        });

        if (result.triggerWorker) {
            runIndividualWaitlistPromotionWorker(eventId, result.correlationId).catch((e) =>
                console.warn("[WaitlistWorker] Non-blocking worker error:", e)
            );
        }
    }

    return result;
}

// =========================================================================
// SC-04: Waitlist Promotion Worker
// =========================================================================
export async function runIndividualWaitlistPromotionWorker(
    eventId: string,
    correlationId?: string
): Promise<string> {
    const db = getAdminFirestore();
    let promotedCount = 0;

    while (true) {
        const now = new Date();
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) break;

        const eventData = eventSnap.data() || {};
        const meta = normalizeEventDoc(eventData);

        if (meta.status !== "UPCOMING" || now >= meta.dateTime || meta.capacityChangeInProgress) {
            break;
        }

        // Direct count of currently confirmed registrations for true capacity calculation
        const confirmedSnap = await db
            .collection("registrations")
            .where("eventId", "==", eventId)
            .where("status", "==", "CONFIRMED")
            .get();

        const actualConfirmed = confirmedSnap.size;
        const totalCapacity = meta.slotsAvailable;

        if (actualConfirmed >= totalCapacity) {
            break; // Event is full, no capacity to promote
        }

        // Query all waitlisted and pending registrations for this event
        const waitlistSnap = await db
            .collection("registrations")
            .where("eventId", "==", eventId)
            .where("status", "in", ["WAITLIST", "PENDING"])
            .get();

        if (waitlistSnap.empty) {
            break;
        }

        // Filter and sort candidates in memory: prioritize sequence/position, then registration time
        const candidateDocs = waitlistSnap.docs
            .filter((d) => {
                const data = d.data();
                return (
                    data.status === "WAITLIST" ||
                    data.status === "PENDING" ||
                    data.lookingForPartner === true
                );
            })
            .sort((a, b) => {
                const dataA = a.data();
                const dataB = b.data();
                const posA = dataA.waitlistPosition ?? dataA.waitlistSequence;
                const posB = dataB.waitlistPosition ?? dataB.waitlistSequence;
                if (typeof posA === "number" && typeof posB === "number" && posA !== posB) {
                    return posA - posB;
                }
                const timeA =
                    (dataA.waitlistedAt || dataA.registeredAt || dataA.createdAt)?.toMillis?.() || 0;
                const timeB =
                    (dataB.waitlistedAt || dataB.registeredAt || dataB.createdAt)?.toMillis?.() || 0;
                return timeA - timeB;
            });

        if (candidateDocs.length === 0) {
            break;
        }

        const candidateDoc = candidateDocs[0];
        const candidateData = candidateDoc.data();
        const candidateId = candidateData.playerId;

        const stepResult = await db.runTransaction(async (tx) => {
            const evSnap = await tx.get(eventRef);
            if (!evSnap.exists) return { stop: true };
            const evData = evSnap.data() || {};
            const evMeta = normalizeEventDoc(evData);

            if (
                evMeta.status !== "UPCOMING" ||
                new Date() >= evMeta.dateTime ||
                evMeta.capacityChangeInProgress
            ) {
                return { stop: true };
            }

            // Transactional confirmation count re-check
            const txConfirmedSnap = await tx.get(
                db
                    .collection("registrations")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "CONFIRMED")
            );
            if (txConfirmedSnap.size >= evMeta.slotsAvailable) {
                return { stop: true };
            }

            const cRegRef = candidateDoc.ref;
            const cRegSnap = await tx.get(cRegRef);
            if (!cRegSnap.exists) {
                return { stop: false, retry: true };
            }
            const currentCandStatus = cRegSnap.data()?.status;
            if (currentCandStatus !== "WAITLIST" && currentCandStatus !== "PENDING") {
                return { stop: false, retry: true };
            }

            // Check candidate eligibility
            const uRef = db.collection("users").doc(candidateId);
            const uSnap = await tx.get(uRef);
            const uData = uSnap.data() || {};
            const eligibility = evaluatePlayerEligibility(uData);

            const serverNow = Timestamp.now();
            const candName =
                (candidateData.fullName ||
                    candidateData.fullNameP1 ||
                    candidateData.playerDisplayName ||
                    uData.displayName ||
                    "Player") as string;

            if (!eligibility.eligible) {
                // Ineligible candidate: cancel & proceed to next
                tx.update(cRegRef, {
                    status: "CANCELLED",
                    waitlistedAt: null,
                    waitlistPosition: null,
                    waitlistSequence: null,
                    cancelledAt: serverNow,
                    cancelReason: "INELIGIBLE_FOR_PROMOTION",
                });
                tx.update(eventRef, {
                    waitlistCount: Math.max(0, evMeta.waitlistCount - 1),
                });
                createAuditLogEntry(db, tx, {
                    eventId,
                    entityType: "REGISTRATION",
                    entityId: candidateDoc.id,
                    action: "INELIGIBLE_FOR_PROMOTION",
                    actorUid: candidateId,
                    actorName: candName,
                    previousState: { status: currentCandStatus },
                    newState: { status: "CANCELLED" },
                    correlationId: correlationId || null,
                    reason: eligibility.message,
                    timestamp: serverNow,
                });
                return { stop: false, promoted: false };
            }

            // Eligible candidate: promote
            tx.update(cRegRef, {
                status: "CONFIRMED",
                confirmedAt: serverNow,
                waitlistedAt: null,
                waitlistPosition: null,
                waitlistSequence: null,
                lookingForPartner: false,
                teamId: null,
            });
            tx.update(eventRef, {
                registrationsCount: txConfirmedSnap.size + 1,
                waitlistCount: Math.max(0, evMeta.waitlistCount - 1),
            });
            createAuditLogEntry(db, tx, {
                eventId,
                entityType: "REGISTRATION",
                entityId: candidateDoc.id,
                action: "PROMOTED",
                actorUid: candidateId,
                actorName: candName,
                previousState: { status: currentCandStatus },
                newState: { status: "CONFIRMED" },
                correlationId: correlationId || null,
                reason: "PROMOTED_FROM_WAITLIST",
                timestamp: serverNow,
            });

            return { stop: false, promoted: true, candidateId, eventName: evMeta.eventName };
        });

        if (stepResult.stop) break;
        if (stepResult.promoted && stepResult.candidateId) {
            promotedCount++;
            createNotificationDoc(db, db.batch(), {
                userId: stepResult.candidateId,
                eventId,
                eventName: stepResult.eventName || "Event",
                type: "WAITLIST_PROMOTED",
                title: "You've Been Promoted! 🎉",
                message: `A spot opened up! Your registration for ${stepResult.eventName} is now confirmed.`,
                correlationId: correlationId || null,
            });
        }
    }

    return `PROMOTED_${promotedCount}`;
}

// =========================================================================
// SC-05 & SC-06: Capacity Increase & Decrease
// =========================================================================
export async function adjustIndividualEventCapacity(
    eventId: string,
    newSlots: number
): Promise<ServiceResult<{ action: string; demotedCount?: number; promotedCount?: number }>> {
    if (newSlots < 0) {
        return { success: false, error: "Capacity cannot be negative." };
    }

    const db = getAdminFirestore();
    const eventRef = db.collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
        return { success: false, error: "Event not found." };
    }

    const meta = normalizeEventDoc(eventSnap.data() || {});
    if (meta.status !== "UPCOMING" || new Date() >= meta.dateTime) {
        return { success: false, error: "Cannot modify capacity for ongoing, past, or cancelled events." };
    }
    if (meta.capacityChangeInProgress) {
        return { success: false, error: "Another capacity reduction is already in progress." };
    }

    // -------------------------------------------------------------------------
    // SC-05: Capacity Increase or Equal
    // -------------------------------------------------------------------------
    if (newSlots >= meta.registrationsCount) {
        await eventRef.update({ slotsAvailable: newSlots });
        if (newSlots > meta.registrationsCount && meta.waitlistCount > 0) {
            runIndividualWaitlistPromotionWorker(eventId).catch((e) =>
                console.warn("[WaitlistWorker] Capacity increase promotion error:", e)
            );
        }
        return {
            success: true,
            data: { action: "CAPACITY_UPDATED", demotedCount: 0 },
        };
    }

    // -------------------------------------------------------------------------
    // SC-06: Capacity Decrease (Fast path <= 20 vs Large reduction > 20)
    // -------------------------------------------------------------------------
    const excessCount = meta.registrationsCount - newSlots;

    // Fast-path: excessCount <= 20 (single atomic transaction)
    if (excessCount <= 20) {
        const demotedPlayerIds: string[] = [];

        const fastResult = await db.runTransaction(async (tx) => {
            const evSnap = await tx.get(eventRef);
            const evData = evSnap.data() || {};
            const evMeta = normalizeEventDoc(evData);

            if (evMeta.status !== "UPCOMING" || new Date() >= evMeta.dateTime) {
                return { success: false, error: "Event is no longer upcoming." };
            }
            if (evMeta.counterReconciliationNeeded) {
                return { success: false, error: "COUNTER_RECONCILIATION_REQUIRED" };
            }

            // Query excess confirmed registrations ordered by confirmedAt DESC, __name__ DESC
            const confirmedQuery = await tx.get(
                db
                    .collection("registrations")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "CONFIRMED")
                    .orderBy("confirmedAt", "desc")
                    .limit(excessCount)
            );

            if (confirmedQuery.docs.length < excessCount) {
                tx.update(eventRef, { counterReconciliationNeeded: true });
                return { success: false, error: "COUNTER_RECONCILIATION_REQUIRED" };
            }

            // Query waitlist tail
            const waitlistTailQuery = await tx.get(
                db
                    .collection("registrations")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "WAITLIST")
                    .orderBy("waitlistedAt", "desc")
                    .limit(1)
            );

            let waitlistBaseMs = Date.now();
            if (!waitlistTailQuery.empty) {
                const tailData = waitlistTailQuery.docs[0].data();
                const tailTs = tailData.waitlistedAt as Timestamp | undefined;
                if (tailTs?.toMillis) {
                    waitlistBaseMs = tailTs.toMillis();
                }
            }

            // Reverse-offset demotion: newest-confirmed gets latest timestamp;
            // earliest-confirmed gets earliest timestamp in cohort
            let remainingExcess = excessCount;
            for (const doc of confirmedQuery.docs) {
                const regData = doc.data();
                const pId = regData.playerId as string;
                demotedPlayerIds.push(pId);

                const demotedWaitlistedAt = Timestamp.fromMillis(waitlistBaseMs + remainingExcess);
                remainingExcess--;

                tx.update(doc.ref, {
                    status: "WAITLIST",
                    confirmedAt: null,
                    waitlistedAt: demotedWaitlistedAt,
                });

                appendAuditEntry(db, tx, eventId, pId, {
                    action: "DEMOTION",
                    previousStatus: "CONFIRMED",
                    newStatus: "WAITLIST",
                    reason: "CAPACITY_REDUCTION",
                    timestamp: demotedWaitlistedAt,
                });
            }

            tx.update(eventRef, {
                slotsAvailable: newSlots,
                registrationsCount: newSlots,
                waitlistCount: evMeta.waitlistCount + excessCount,
            });

            return { success: true };
        });

        if (!fastResult.success) {
            return { success: false, error: fastResult.error };
        }

        // Notify demoted players post-commit
        for (const pId of demotedPlayerIds) {
            createNotificationDoc(db, db.batch(), {
                userId: pId,
                eventId,
                eventName: meta.eventName,
                type: "CAPACITY_REDUCTION_DEMOTED",
                title: "Event Capacity Reduced",
                message: `Due to an administrative reduction in slots for ${meta.eventName}, your registration has been moved to the waitlist based on registration seniority.`,
            });
        }

        return {
            success: true,
            data: { action: "CAPACITY_REDUCED_FAST", demotedCount: excessCount },
        };
    }

    // Large-reduction path (excessCount > 20): Leased multi-step reduction
    const runId = `cap_run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const leaseDurationMs = 2 * 60 * 1000;
    const lockExpiresAt = Timestamp.fromMillis(Date.now() + leaseDurationMs);

    // Initial lock transaction
    await db.runTransaction(async (tx) => {
        const evSnap = await tx.get(eventRef);
        const evMeta = normalizeEventDoc(evSnap.data() || {});

        const waitlistTailQuery = await tx.get(
            db
                .collection("registrations")
                .where("eventId", "==", eventId)
                .where("status", "==", "WAITLIST")
                .orderBy("waitlistedAt", "desc")
                .limit(1)
        );

        let baseTs = Timestamp.now();
        if (!waitlistTailQuery.empty) {
            const tailTs = waitlistTailQuery.docs[0].data().waitlistedAt;
            if (tailTs instanceof Timestamp) baseTs = tailTs;
        }

        tx.update(eventRef, {
            capacityChangeInProgress: true,
            pendingSlotsAvailable: newSlots,
            pendingWaitlistBaseAt: baseTs,
            capacityChangeRunId: runId,
            capacityLockExpiresAt: lockExpiresAt,
        });
    });

    // Demote one by one until registrationsCount <= pendingSlotsAvailable
    let demotedTotal = 0;
    while (true) {
        const stepResult = await db.runTransaction(async (tx) => {
            const evSnap = await tx.get(eventRef);
            const evData = evSnap.data() || {};
            if (
                !evData.capacityChangeInProgress ||
                evData.capacityChangeRunId !== runId ||
                evData.status === "Cancelled" ||
                evData.status === "CANCELLED"
            ) {
                return { done: true };
            }

            const currentConfirmed = Number(evData.registrationsCount || 0);
            const target = Number(evData.pendingSlotsAvailable);
            if (currentConfirmed <= target) {
                // Finalize reduction
                tx.update(eventRef, {
                    slotsAvailable: target,
                    capacityChangeInProgress: false,
                    pendingSlotsAvailable: null,
                    pendingWaitlistBaseAt: null,
                    capacityLockExpiresAt: null,
                    capacityChangeRunId: null,
                });
                return { done: true };
            }

            // Find most recently confirmed registration
            const confSnap = await tx.get(
                db
                    .collection("registrations")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "CONFIRMED")
                    .orderBy("confirmedAt", "desc")
                    .limit(1)
            );

            if (confSnap.empty) {
                tx.update(eventRef, { counterReconciliationNeeded: true });
                return { done: true };
            }

            const docToDemote = confSnap.docs[0];
            const pId = docToDemote.data().playerId as string;
            const remainingExcess = currentConfirmed - target;
            const baseTs = evData.pendingWaitlistBaseAt as Timestamp;
            const demotedTs = Timestamp.fromMillis((baseTs?.toMillis?.() || Date.now()) + remainingExcess);

            tx.update(docToDemote.ref, {
                status: "WAITLIST",
                confirmedAt: null,
                waitlistedAt: demotedTs,
            });

            tx.update(eventRef, {
                registrationsCount: currentConfirmed - 1,
                waitlistCount: Number(evData.waitlistCount || 0) + 1,
                capacityLockExpiresAt: Timestamp.fromMillis(Date.now() + leaseDurationMs),
            });

            appendAuditEntry(db, tx, eventId, pId, {
                action: "DEMOTION",
                previousStatus: "CONFIRMED",
                newStatus: "WAITLIST",
                reason: "CAPACITY_REDUCTION",
                timestamp: demotedTs,
            });

            return { done: false, demotedPlayerId: pId, eventName: evData.eventName };
        });

        if (stepResult.done) break;
        if (stepResult.demotedPlayerId) {
            demotedTotal++;
            createNotificationDoc(db, db.batch(), {
                userId: stepResult.demotedPlayerId,
                eventId,
                eventName: stepResult.eventName || meta.eventName,
                type: "CAPACITY_REDUCTION_DEMOTED",
                title: "Moved to Waitlist",
                message: `Due to a capacity reduction for ${stepResult.eventName}, your registration has been moved to the waitlist.`,
            });
        }
    }

    return {
        success: true,
        data: { action: "CAPACITY_REDUCED_LARGE", demotedCount: demotedTotal },
    };
}

// =========================================================================
// SC-08: Administrator Cancels Event
// =========================================================================
export async function cancelIndividualEvent(
    eventId: string,
    cancellationMessage?: string
): Promise<ServiceResult<{ action: string; cancelledCount: number }>> {
    const db = getAdminFirestore();
    const eventRef = db.collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
        return { success: false, error: "Event not found." };
    }

    const eventData = eventSnap.data() || {};
    const meta = normalizeEventDoc(eventData);

    // 1. Transactionally cancel event and clear capacity flags
    await db.runTransaction(async (tx) => {
        tx.update(eventRef, {
            status: "Cancelled",
            eventStatus: "CANCELLED",
            capacityChangeInProgress: false,
            pendingSlotsAvailable: null,
            pendingWaitlistBaseAt: null,
            capacityLockExpiresAt: null,
            capacityChangeRunId: null,
            registrationsCount: 0,
            waitlistCount: 0,
            cancellationMessage: cancellationMessage || "Event cancelled by administrator.",
        });
    });

    // 2. Fetch active registrations (CONFIRMED & WAITLIST)
    const regsSnap = await db.collection("registrations").where("eventId", "==", eventId).get();
    const activeDocs = regsSnap.docs.filter((d) => {
        const s = d.data().status;
        return s === "CONFIRMED" || s === "WAITLIST";
    });

    const serverNow = Timestamp.now();
    let batch = db.batch();
    let opCount = 0;
    const notifiedPlayerIds: string[] = [];

    for (const doc of activeDocs) {
        const pId = doc.data().playerId as string;
        const prevStatus = doc.data().status as string;

        batch.update(doc.ref, {
            status: "CANCELLED",
            confirmedAt: null,
            waitlistedAt: null,
            cancelledAt: serverNow,
            cancelReason: "EVENT_CANCELLED",
        });
        opCount++;

        appendAuditEntry(db, batch, eventId, pId, {
            action: "EVENT_CANCELLED",
            previousStatus: prevStatus,
            newStatus: "CANCELLED",
            reason: cancellationMessage || "EVENT_CANCELLED",
            timestamp: serverNow,
        });
        opCount++;

        notifiedPlayerIds.push(pId);

        if (opCount >= 400) {
            await batch.commit();
            batch = db.batch();
            opCount = 0;
        }
    }

    if (opCount > 0) {
        await batch.commit();
    }

    // 3. Notify all affected players
    for (const pId of notifiedPlayerIds) {
        createNotificationDoc(db, db.batch(), {
            userId: pId,
            eventId,
            eventName: meta.eventName,
            type: "EVENT_CANCELLED",
            title: "Event Cancelled",
            message: `The event "${meta.eventName}" has been cancelled. ${cancellationMessage ? `Reason: ${cancellationMessage}` : ""}`,
        });
    }

    return {
        success: true,
        data: { action: "EVENT_CANCELLED", cancelledCount: activeDocs.length },
    };
}

// =========================================================================
// SC-09: Administrator Clears Red Flag
// =========================================================================
export async function clearPlayerRedFlag(
    targetUid: string,
    adminUid: string,
    reason?: string
): Promise<ServiceResult<{ clearedUid: string }>> {
    const db = getAdminFirestore();
    const userRef = db.collection("users").doc(targetUid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        return { success: false, error: "User not found." };
    }

    await db.runTransaction(async (tx) => {
        tx.update(userRef, {
            redflagged: false,
            redflaggedAt: null,
            redflagReason: null,
            redflagEventId: null,
        });

        // Record moderation audit entry
        const auditRef = db.collection("moderation_audit").doc();
        tx.set(auditRef, {
            targetUid,
            action: "CLEAR_RED_FLAG",
            performedBy: adminUid,
            reason: reason || "Admin cleared red flag",
            timestamp: Timestamp.now(),
        });
    });

    createNotificationDoc(db, db.batch(), {
        userId: targetUid,
        eventId: "",
        eventName: "Account Notice",
        type: "RED_FLAG_CLEARED",
        title: "Account Status Restored",
        message: "Your red-flag status has been cleared by an administrator. You can now register for events.",
    });

    return { success: true, data: { clearedUid: targetUid } };
}
