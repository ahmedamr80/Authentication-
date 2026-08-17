import { getAdminFirestore } from "@/lib/firebase-admin";

export interface RefreshTokenFamilyRecord {
    familyId: string;
    uid: string;
    currentJti: string;
    usedJtis: string[];
    isRevoked: boolean;
    revokedReason?: string;
    initialLoginAt: number; // Epoch milliseconds (Initial login timestamp)
    createdAt: number;
    lastRefreshedAt: number;
}

export const ABSOLUTE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days hard cap

export const inMemoryFamilyStore = new Map<string, RefreshTokenFamilyRecord>();

/**
 * Initializes a new session family when a user authenticates.
 */
export async function createSessionFamily(uid: string, familyId: string, initialJti: string): Promise<RefreshTokenFamilyRecord> {
    const now = Date.now();
    const record: RefreshTokenFamilyRecord = {
        familyId,
        uid,
        currentJti: initialJti,
        usedJtis: [],
        isRevoked: false,
        initialLoginAt: now,
        createdAt: now,
        lastRefreshedAt: now,
    };

    inMemoryFamilyStore.set(familyId, record);

    try {
        const adminDb = getAdminFirestore();
        await adminDb.collection("refresh_token_families").doc(familyId).set(record);
    } catch (err) {
        console.error("Error storing session family in Firestore:", err);
    }

    return record;
}

/**
 * Retrieves a session family record by familyId.
 * Firestore is authoritative; in-memory cache is a fallback for Firestore failures.
 */
export async function getSessionFamily(familyId: string): Promise<RefreshTokenFamilyRecord | null> {
    try {
        const adminDb = getAdminFirestore();
        const docSnap = await adminDb.collection("refresh_token_families").doc(familyId).get();
        if (docSnap.exists) {
            const data = docSnap.data() as RefreshTokenFamilyRecord;
            inMemoryFamilyStore.set(familyId, data);
            return data;
        }
    } catch (err) {
        console.error("Error fetching session family from Firestore:", err);
        // Fall back to in-memory cache only on Firestore failure
        if (inMemoryFamilyStore.has(familyId)) {
            return inMemoryFamilyStore.get(familyId)!;
        }
    }

    return null;
}

export interface RotationResult {
    success: boolean;
    error?: string;
    newJti?: string;
    familyRevoked?: boolean;
}

/**
 * Rotates a refresh token in a session family.
 * Detects token reuse (replay attacks) and enforces the 30-day absolute session cap.
 */
export async function rotateSessionFamilyToken(
    familyId: string,
    submittedJti: string,
    newJti: string
): Promise<RotationResult> {
    const family = await getSessionFamily(familyId);

    if (!family) {
        return { success: false, error: "Session family not found.", familyRevoked: true };
    }

    const now = Date.now();

    // 1. Check if Family is Already Revoked
    if (family.isRevoked) {
        return {
            success: false,
            error: "Session has been revoked due to security event.",
            familyRevoked: true,
        };
    }

    // 2. Enforce 30-Day Absolute Session Lifetime Cap
    if (now - family.initialLoginAt > ABSOLUTE_SESSION_MAX_AGE_MS) {
        family.isRevoked = true;
        family.revokedReason = "ABSOLUTE_SESSION_CAP_EXCEEDED";
        inMemoryFamilyStore.set(familyId, family);

        try {
            const adminDb = getAdminFirestore();
            await adminDb.collection("refresh_token_families").doc(familyId).update({
                isRevoked: true,
                revokedReason: "ABSOLUTE_SESSION_CAP_EXCEEDED",
            });
        } catch (err) {
            console.error("Error updating revoked family in Firestore:", err);
        }

        return {
            success: false,
            error: "Maximum session lifetime reached (30 days). Please sign in again.",
            familyRevoked: true,
        };
    }

    // 3. Check for Token Reuse (Security Breach Circuit Breaker!)
    if (family.usedJtis.includes(submittedJti)) {
        // REUSE DETECTED! Revoke entire session family lineage immediately!
        family.isRevoked = true;
        family.revokedReason = "REFRESH_TOKEN_REUSE_DETECTED";
        inMemoryFamilyStore.set(familyId, family);

        console.error(`[SECURITY-ALARM] Refresh token reuse detected for family ${familyId}! Revoking entire session lineage.`);

        try {
            const adminDb = getAdminFirestore();
            await adminDb.collection("refresh_token_families").doc(familyId).update({
                isRevoked: true,
                revokedReason: "REFRESH_TOKEN_REUSE_DETECTED",
            });
        } catch (err) {
            console.error("Error revoking session family in Firestore:", err);
        }

        return {
            success: false,
            error: "Security Alert: Refresh token reuse detected. All active sessions have been revoked.",
            familyRevoked: true,
        };
    }

    // 4. Validate Current Active JTI
    if (family.currentJti !== submittedJti) {
        return { success: false, error: "Invalid refresh token identifier.", familyRevoked: false };
    }

    // 5. Legitimate Refresh -> Rotate JTI!
    family.usedJtis.push(submittedJti);
    family.currentJti = newJti;
    family.lastRefreshedAt = now;

    inMemoryFamilyStore.set(familyId, family);

    try {
        const adminDb = getAdminFirestore();
        await adminDb.collection("refresh_token_families").doc(familyId).update({
            usedJtis: family.usedJtis,
            currentJti: newJti,
            lastRefreshedAt: now,
        });
    } catch (err) {
        console.error("Error updating rotated session family in Firestore:", err);
    }

    return { success: true, newJti };
}

/**
 * Revokes all sessions in a token family (e.g. on manual logout or compromise).
 */
export async function revokeSessionFamily(familyId: string, reason: string = "USER_LOGOUT"): Promise<void> {
    const family = await getSessionFamily(familyId);
    if (family) {
        family.isRevoked = true;
        family.revokedReason = reason;
        inMemoryFamilyStore.set(familyId, family);
    }

    try {
        const adminDb = getAdminFirestore();
        await adminDb.collection("refresh_token_families").doc(familyId).update({
            isRevoked: true,
            revokedReason: reason,
        });
    } catch (err) {
        console.error("Error revoking session family in Firestore:", err);
    }
}
