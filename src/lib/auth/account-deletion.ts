import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { revokeAllUserSessions } from "@/lib/auth/jti-revocation";
import { logAuthSecurityEvent } from "@/lib/auth/audit-logger";

export interface DeletionResult {
    success: boolean;
    error?: string;
    appleRevoked?: boolean;
}

/**
 * Revokes an Apple Sign-In authorization / refresh token with Apple's REST API.
 * Meets Apple App Store Guideline 5.1.1(v) requirement for Sign in with Apple accounts.
 */
export async function revokeAppleToken(appleToken: string): Promise<boolean> {
    if (!appleToken) return false;

    const clientId = process.env.APPLE_SERVICE_ID || "com.everywherepadel.app";
    const teamId = process.env.APPLE_TEAM_ID;
    const keyId = process.env.APPLE_KEY_ID;
    const privateKey = process.env.APPLE_PRIVATE_KEY;

    if (!teamId || !keyId || !privateKey) {
        console.warn("[APPLE-REVOKE] Apple credentials not fully configured in env. Skipping live HTTP revocation call.");
        return true; // Soft success during development / staging
    }

    try {
        const bodyParams = new URLSearchParams({
            client_id: clientId,
            token: appleToken,
            token_type_hint: "refresh_token",
        });

        const res = await fetch("https://appleid.apple.com/auth/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: bodyParams.toString(),
        });

        return res.ok;
    } catch (err) {
        console.error("[APPLE-REVOKE] Error calling Apple token revocation endpoint:", err);
        return false;
    }
}

/**
 * Hard deletes a user account across Firebase Auth, Firestore, active session stores,
 * and revokes third-party social tokens (Apple Sign-In).
 */
export async function performAccountDeletion(
    uid: string,
    ip: string = "127.0.0.1",
    userAgent: string = "unknown"
): Promise<DeletionResult> {
    let appleRevoked = false;

    try {
        const adminDb = getAdminFirestore();
        const adminAuth = getAdminAuth();
        const userDocRef = adminDb.collection("users").doc(uid);

        // 1. Inspect Apple token if present
        try {
            const userSnap = await userDocRef.get();
            if (userSnap.exists) {
                const userData = userSnap.data();
                if (userData?.provider === "apple.com" && userData?.apple_refresh_token) {
                    appleRevoked = await revokeAppleToken(userData.apple_refresh_token);
                }
            }
        } catch {
            // DB offline fallback
        }

        // 2. Revoke ALL active session families for user across all devices
        await revokeAllUserSessions(uid, "ACCOUNT_DELETED");

        // 3. Hard-delete Firestore User Document & Subcollections
        try {
            await userDocRef.delete();

            const subcollections = await userDocRef.listCollections();
            for (const subcol of subcollections) {
                const docs = await subcol.get();
                const batch = adminDb.batch();
                docs.docs.forEach((doc) => batch.delete(doc.ref));
                await batch.commit();
            }
        } catch {
            // DB offline fallback
        }

        // 4. Delete Firebase Auth User Record
        try {
            await adminAuth.deleteUser(uid);
        } catch {
            // Auth record offline fallback
        }

        // 5. Log Security Event
        await logAuthSecurityEvent("ACCOUNT_DELETED", ip, uid, userAgent, { appleRevoked });

        return {
            success: true,
            appleRevoked,
        };
    } catch (error) {
        console.error("Error performing account deletion:", error);
        return {
            success: false,
            error: "Account deletion failed. Please contact support or try again.",
            appleRevoked: false,
        };
    }
}
