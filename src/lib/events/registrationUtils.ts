import { Timestamp } from "firebase-admin/firestore";
import { parseFirebaseDate } from "@/lib/date-utils";

export interface LateWithdrawalEvaluation {
    isLate: boolean;
    thresholdHours: number;
    thresholdDate: Date;
}

/**
 * Calculates late withdrawal window per business rules:
 * - Event start time < 12:00 local -> 18 hours before event
 * - Event start time >= 12:00 local -> 12 hours before event
 * Default timezone: "Asia/Dubai" (UAE standard)
 */
export function calculateLateWithdrawalWindow(
    eventDateTimeInput: unknown,
    timeZone: string = "Asia/Dubai"
): LateWithdrawalEvaluation {
    const eventDate = parseFirebaseDate(eventDateTimeInput) || new Date();
    
    // Determine local start hour in configured timezone
    let localHour = eventDate.getHours();
    try {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour: "numeric",
            hourCycle: "h23",
        });
        const parts = formatter.formatToParts(eventDate);
        const hourPart = parts.find((p) => p.type === "hour");
        if (hourPart) {
            localHour = parseInt(hourPart.value, 10);
        }
    } catch {
        // Fallback to local JS hour if timezone is invalid
        localHour = eventDate.getHours();
    }

    const thresholdHours = localHour < 12 ? 18 : 12;
    const thresholdMs = thresholdHours * 60 * 60 * 1000;
    const thresholdDate = new Date(eventDate.getTime() - thresholdMs);
    const now = Date.now();

    return {
        isLate: now >= thresholdDate.getTime(),
        thresholdHours,
        thresholdDate,
    };
}

/**
 * Deterministic registration document ID: registrations/{eventId}_{playerId}
 */
export function getRegistrationDocId(eventId: string, playerId: string): string {
    return `${eventId}_${playerId}`;
}

export interface PlayerEligibilityResult {
    eligible: boolean;
    reason?: "REDFLAGGED" | "EMAIL_NOT_VERIFIED" | "PHONE_NOT_VERIFIED" | "USER_NOT_FOUND";
    message: string;
}

/**
 * Server-side player eligibility check:
 * 1. redflagged == false
 * 2. emailVerified == true
 * 3. phoneVerified == true (or valid phone on profile)
 */
export function evaluatePlayerEligibility(
    userData?: Record<string, unknown> | null,
    authRecord?: { emailVerified?: boolean; phoneNumber?: string } | null
): PlayerEligibilityResult {
    if (!userData) {
        return {
            eligible: false,
            reason: "USER_NOT_FOUND",
            message: "User account not found.",
        };
    }

    if (userData.redflagged === true) {
        return {
            eligible: false,
            reason: "REDFLAGGED",
            message: "Your account is red-flagged due to a previous late withdrawal. Please contact an administrator.",
        };
    }

    const emailVerified =
        userData.emailVerified === true ||
        userData.emailVerified === "true" ||
        authRecord?.emailVerified === true ||
        userData.is_email_verified === true ||
        userData.is_email_verified === "true";

    if (!emailVerified) {
        return {
            eligible: false,
            reason: "EMAIL_NOT_VERIFIED",
            message: "Please verify your email address before participating in events.",
        };
    }

    const hasPhone =
        userData.phoneVerified === true ||
        userData.phoneVerified === "true" ||
        userData.is_phone_verified === true ||
        userData.is_phone_verified === "true" ||
        (typeof userData.phone === "string" && userData.phone.trim().length >= 8) ||
        (typeof userData.phoneNumber === "string" && userData.phoneNumber.trim().length >= 8) ||
        (typeof authRecord?.phoneNumber === "string" && authRecord.phoneNumber.trim().length >= 8);

    if (!hasPhone) {
        return {
            eligible: false,
            reason: "PHONE_NOT_VERIFIED",
            message: "A verified phone number is required to participate in events.",
        };
    }

    return {
        eligible: true,
        message: "Eligible.",
    };
}

/**
 * Resolves player eligibility, querying Firebase Admin Auth if email verification or phone
 * is missing from the Firestore document.
 */
export async function resolvePlayerEligibilityWithAuth(
    userData?: Record<string, unknown> | null,
    playerId?: string,
    providedAuth?: { emailVerified?: boolean; phoneNumber?: string } | null
): Promise<PlayerEligibilityResult & {
    authRecord?: { emailVerified?: boolean; phoneNumber?: string };
    shouldSyncEmail?: boolean;
}> {
    const effectiveAuth: { emailVerified?: boolean; phoneNumber?: string } = {
        ...(providedAuth || {}),
    };

    const docHasEmailVerified =
        userData?.emailVerified === true ||
        userData?.emailVerified === "true" ||
        userData?.is_email_verified === true ||
        userData?.is_email_verified === "true";

    const docHasPhone =
        userData?.phoneVerified === true ||
        userData?.phoneVerified === "true" ||
        userData?.is_phone_verified === true ||
        userData?.is_phone_verified === "true" ||
        (typeof userData?.phone === "string" && userData.phone.trim().length >= 8) ||
        (typeof userData?.phoneNumber === "string" && userData.phoneNumber.trim().length >= 8);

    if (playerId && (!docHasEmailVerified || !docHasPhone)) {
        if (effectiveAuth.emailVerified === undefined || !effectiveAuth.phoneNumber) {
            try {
                const { getAdminAuth } = await import("@/lib/firebase-admin");
                const adminUser = await getAdminAuth().getUser(playerId);
                if (effectiveAuth.emailVerified === undefined) {
                    effectiveAuth.emailVerified = !!adminUser.emailVerified;
                }
                if (!effectiveAuth.phoneNumber && adminUser.phoneNumber) {
                    effectiveAuth.phoneNumber = adminUser.phoneNumber;
                }
            } catch {
                // User may not exist in Firebase Auth or custom auth system
            }
        }
    }

    const evalResult = evaluatePlayerEligibility(userData, effectiveAuth);
    const shouldSyncEmail = !docHasEmailVerified && effectiveAuth.emailVerified === true;

    return {
        ...evalResult,
        authRecord: effectiveAuth,
        shouldSyncEmail,
    };
}

/**
 * Normalizes event metadata across legacy & current schemas
 */
export function normalizeEventDoc(data: Record<string, unknown>) {
    const dateTimeRaw = data.dateTime || data.eventStartAt || data.eventDate;
    const dateTime = parseFirebaseDate(dateTimeRaw) || new Date();

    const unitTypeRaw = String(data.unitType || "Players").toLowerCase();
    const unitType: "players" | "teams" = unitTypeRaw === "teams" ? "teams" : "players";

    const slotsAvailable = Number(data.slotsAvailable ?? data.maxPlayers ?? 0);
    const registrationsCount = Number(data.registrationsCount ?? data.confirmedTeamsCount ?? 0);
    const waitlistCount = Number(data.waitlistCount ?? 0);
    const nextWaitlistSeq = Number(data.nextWaitlistSeq ?? 1);
    const inviteTtlHours = Number(data.inviteTtlHours ?? 24);

    const statusRaw = String(data.status || data.eventStatus || "UPCOMING");
    const isCancelled = statusRaw.toLowerCase() === "cancelled";
    const status: "UPCOMING" | "ONGOING" | "PAST" | "CANCELLED" = isCancelled
        ? "CANCELLED"
        : (statusRaw.toUpperCase() as "UPCOMING" | "ONGOING" | "PAST" | "CANCELLED");

    const capacityChangeInProgress = Boolean(data.capacityChangeInProgress);
    const counterReconciliationNeeded = Boolean(data.counterReconciliationNeeded);
    const timeZone = (data.timeZone as string) || "Asia/Dubai";

    return {
        dateTime,
        dateTimeTimestamp: Timestamp.fromDate(dateTime),
        unitType,
        slotsAvailable,
        registrationsCount,
        waitlistCount,
        nextWaitlistSeq,
        inviteTtlHours,
        status,
        capacityChangeInProgress,
        counterReconciliationNeeded,
        timeZone,
        eventName: (data.eventName || data.title || "Event") as string,
    };
}

/**
 * Appends an immutable audit entry to registrations/{eventId}_{playerId}/audit_trail/{auditId}
 */
export function appendAuditEntry(
    db: FirebaseFirestore.Firestore,
    batchOrTx: { set: (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => unknown },
    eventId: string,
    playerId: string,
    entry: {
        action: string;
        previousStatus?: string | null;
        newStatus: string;
        reason?: string | null;
        timestamp?: Date | Timestamp;
    }
) {
    const regId = getRegistrationDocId(eventId, playerId);
    const auditRef = db.collection("registrations").doc(regId).collection("audit_trail").doc();
    const ts = entry.timestamp instanceof Timestamp
        ? entry.timestamp
        : (entry.timestamp ? Timestamp.fromDate(entry.timestamp) : Timestamp.now());

    batchOrTx.set(auditRef, {
        auditId: auditRef.id,
        action: entry.action,
        previousStatus: entry.previousStatus ?? null,
        newStatus: entry.newStatus,
        reason: entry.reason ?? null,
        timestamp: ts,
    });
}

/**
 * Creates an in-app notification document
 */
export function createNotificationDoc(
    db: FirebaseFirestore.Firestore,
    batchOrTx: { set: (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => unknown },
    params: {
        userId: string;
        fromUserId?: string | null;
        eventId: string;
        eventName: string;
        teamId?: string | null;
        type: string;
        title: string;
        message: string;
        correlationId?: string | null;
    }
) {
    const notifRef = db.collection("notifications").doc();
    batchOrTx.set(notifRef, {
        notificationId: notifRef.id,
        userId: params.userId,
        fromUserId: params.fromUserId || null,
        eventId: params.eventId,
        eventName: params.eventName,
        teamId: params.teamId || null,
        type: params.type,
        title: params.title,
        message: params.message,
        correlationId: params.correlationId || null,
        read: false,
        createdAt: Timestamp.now(),
    });
}
