import { getAdminFirestore } from "@/lib/firebase-admin";
import { revokeSessionFamily, inMemoryFamilyStore } from "@/lib/auth/session-family";

export interface RevokedJtiEntry {
    jti: string;
    exp: number; // epoch seconds
}

const inMemoryRevokedJtis = new Map<string, number>();

function cleanupExpiredJtis() {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of inMemoryRevokedJtis.entries()) {
        if (nowSec >= exp) {
            inMemoryRevokedJtis.delete(jti);
        }
    }
}

/**
 * Adds an access token JTI to the short-lived revocation list until its natural expiry time.
 * Persists to Cloud Firestore as authoritative store and syncs local cache.
 */
export async function revokeJti(jti: string, exp: number): Promise<void> {
    if (!jti) return;
    cleanupExpiredJtis();

    inMemoryRevokedJtis.set(jti, exp);

    try {
        const adminDb = getAdminFirestore();
        await adminDb.collection("revoked_jtis").doc(jti).set({
            jti,
            exp,
            createdAt: new Date().toISOString(),
        });
    } catch {
        // Fallback to in-memory store silently if offline/unconfigured
    }
}

/**
 * Checks whether an access token JTI has been revoked.
 * ALWAYS queries Cloud Firestore first as authoritative multi-instance persistent store,
 * updating the local in-memory Map as a performance cache.
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
    if (!jti) return false;
    cleanupExpiredJtis();

    // 1. Authoritative Firestore DB query first
    try {
        const adminDb = getAdminFirestore();
        const docSnap = await adminDb.collection("revoked_jtis").doc(jti).get();
        if (docSnap.exists) {
            const data = docSnap.data();
            const nowSec = Math.floor(Date.now() / 1000);
            if (data?.exp && nowSec < data.exp) {
                inMemoryRevokedJtis.set(jti, data.exp);
                return true; // Authoritatively revoked!
            }
        }
    } catch {
        // Fallback to memory cache if offline/unconfigured
    }

    // 2. Local memory cache fallback
    const exp = inMemoryRevokedJtis.get(jti);
    if (!exp) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= exp) {
        inMemoryRevokedJtis.delete(jti);
        return false; // Expired naturally
    }

    return true; // Revoked!
}

/**
 * Global Sign-Out: Revokes ALL active session families associated with a user UID in Firestore.
 */
export async function revokeAllUserSessions(uid: string, reason: string = "GLOBAL_SIGN_OUT"): Promise<number> {
    let count = 0;

    try {
        const adminDb = getAdminFirestore();
        const snapshot = await adminDb
            .collection("refresh_token_families")
            .where("uid", "==", uid)
            .where("isRevoked", "==", false)
            .get();

        const batch = adminDb.batch();
        snapshot.docs.forEach((docSnap) => {
            count++;
            batch.update(docSnap.ref, {
                isRevoked: true,
                revokedReason: reason,
                revokedAt: new Date().toISOString(),
            });

            // Sync in-memory store
            revokeSessionFamily(docSnap.id, reason);
        });

        if (count > 0) {
            await batch.commit();
        }
    } catch {
        // Fallback: sync in-memory records
    }

    // Direct in-memory cleanup fallback for unit test environment
    if (inMemoryFamilyStore) {
        for (const [, rec] of inMemoryFamilyStore.entries()) {
            if (rec.uid === uid && !rec.isRevoked) {
                rec.isRevoked = true;
                rec.revokedReason = reason;
                count++;
            }
        }
    }

    return count;
}
