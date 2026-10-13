import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAccessToken } from "@/lib/auth/tokens";

export interface AuthenticatedUser {
    uid: string;
    email?: string;
    emailVerified?: boolean;
    phoneNumber?: string;
    isAdmin: boolean;
}

/**
 * Extracts and authenticates user from Request Authorization header.
 * Supports both Firebase ID Tokens and custom JWT access tokens.
 */
export async function resolveUserFromRequest(request: Request): Promise<AuthenticatedUser | null> {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.substring(7).trim();
    if (!token) return null;

    const checkFirestoreAdmin = async (uid: string): Promise<boolean> => {
        try {
            const db = getAdminFirestore();
            const snap = await db.collection("users").doc(uid).get();
            if (snap.exists) {
                const data = snap.data();
                const isAdminVal = data?.isAdmin;
                const isTrue = isAdminVal === true || isAdminVal === "true" || isAdminVal === "True";
                const roleIsAdmin = typeof data?.role === "string" && data.role.toLowerCase() === "admin";
                return isTrue || roleIsAdmin;
            }
        } catch (e) {
            console.error("[resolveUserFromRequest] Firestore admin fallback error:", e);
        }
        return false;
    };

    // 1. Try Firebase Admin verifyIdToken
    try {
        const adminAuth = getAdminAuth();
        const decoded = await adminAuth.verifyIdToken(token);
        let isAdmin = !!decoded.admin || decoded.role === "admin";
        if (!isAdmin) {
            isAdmin = await checkFirestoreAdmin(decoded.uid);
        }
        return {
            uid: decoded.uid,
            email: decoded.email,
            emailVerified: !!decoded.email_verified,
            phoneNumber: decoded.phone_number,
            isAdmin,
        };
    } catch {
        // 2. Fall back to custom token verification
        try {
            const decodedCustom = await verifyAccessToken(token);
            let isAdmin = !!decodedCustom.isAdmin || decodedCustom.role === "admin";
            if (!isAdmin) {
                isAdmin = await checkFirestoreAdmin(decodedCustom.sub);
            }
            return {
                uid: decodedCustom.sub,
                email: decodedCustom.email,
                emailVerified: !!decodedCustom.isEmailVerified,
                isAdmin,
            };
        } catch {
            return null;
        }
    }
}
