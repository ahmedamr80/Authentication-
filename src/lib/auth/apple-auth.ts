import { getAdminFirestore } from "@/lib/firebase-admin";

export interface SocialUserPayload {
    provider: "apple" | "google";
    sub: string; // OIDC Subject Claim (Durable Identity)
    email: string;
    fullName?: string;
    photoUrl?: string;
}

/**
 * Environment configuration placeholders for Sign in with Apple server-to-server validation.
 * Users can supply real credentials in production environment variables.
 */
export const APPLE_CONFIG = {
    serviceId: process.env.APPLE_SERVICE_ID || "com.ewpuae.app.service",
    teamId: process.env.APPLE_TEAM_ID || "YOUR_APPLE_TEAM_ID_PLACEHOLDER",
    keyId: process.env.APPLE_KEY_ID || "YOUR_APPLE_KEY_ID_PLACEHOLDER",
    privateKey: process.env.APPLE_PRIVATE_KEY || "YOUR_APPLE_PRIVATE_KEY_PLACEHOLDER",
};

/**
 * Provisions or logs in a social user using provider `sub` claim mapping and first-time name preservation.
 */
export async function processSocialLoginUser(payload: SocialUserPayload) {
    const adminDb = getAdminFirestore();
    const { provider, sub, email, fullName, photoUrl } = payload;

    const normalizedEmail = email.trim().toLowerCase();
    const federatedId = `${provider}:${sub}`;

    const usersRef = adminDb.collection("users");

    // 1. Primary lookup by durable provider `sub` claim
    const subQuery = await usersRef.where("federatedId", "==", federatedId).get();

    if (!subQuery.empty) {
        const existingDoc = subQuery.docs[0];
        const existingData = existingDoc.data();
        const uid = existingDoc.id;

        const updatePayload: Record<string, unknown> = {
            lastLoginAt: new Date().toISOString(),
            is_email_verified: true,
        };

        // First-Time Name Preservation Rule:
        // Update name ONLY if a valid name is provided AND stored name is empty.
        // Never overwrite existing stored name with null/undefined on subsequent logins!
        if (fullName && fullName.trim() !== "" && (!existingData.fullName || existingData.fullName.trim() === "")) {
            updatePayload.fullName = fullName.trim();
        }

        if (photoUrl && photoUrl !== existingData.photoUrl) {
            updatePayload.photoUrl = photoUrl;
        }

        await existingDoc.ref.update(updatePayload);
        return { uid, isNewUser: false, data: { ...existingData, ...updatePayload } };
    }

    // 2. Secondary lookup by email to link existing accounts
    const emailQuery = await usersRef.where("email", "==", normalizedEmail).get();

    if (!emailQuery.empty) {
        const existingDoc = emailQuery.docs[0];
        const existingData = existingDoc.data();
        const uid = existingDoc.id;

        const updatePayload: Record<string, unknown> = {
            federatedId,
            providerSub: sub,
            provider,
            lastLoginAt: new Date().toISOString(),
            is_email_verified: true,
        };

        // First-Time Name Preservation
        if (fullName && fullName.trim() !== "" && (!existingData.fullName || existingData.fullName.trim() === "")) {
            updatePayload.fullName = fullName.trim();
        }

        await existingDoc.ref.update(updatePayload);
        return { uid, isNewUser: false, data: { ...existingData, ...updatePayload } };
    }

    // 3. New Account Provisioning
    const newUid = `user_${provider}_${sub}`;
    const isPrivateRelay = normalizedEmail.endsWith("@privaterelay.appleid.com");

    const newUserRecord = {
        uid: newUid,
        email: normalizedEmail,
        fullName: (fullName && fullName.trim() !== "") ? fullName.trim() : "",
        photoUrl: photoUrl || "",
        federatedId,
        providerSub: sub,
        provider,
        is_email_verified: true,
        isPrivateRelayEmail: isPrivateRelay,
        role: "player",
        isAdmin: false,
        isShadow: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
    };

    await usersRef.doc(newUid).set(newUserRecord);
    return { uid: newUid, isNewUser: true, data: newUserRecord };
}
