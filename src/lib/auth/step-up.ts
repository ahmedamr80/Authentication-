import { getAdminFirestore } from "@/lib/firebase-admin";

export interface StepUpResult {
    verified: boolean;
    error?: string;
}

/**
 * Validates step-up authentication (re-entering password) for sensitive mid-session operations
 * such as changing password, modifying payment options, or deleting account.
 */
export async function verifyStepUpAuthentication(
    uid: string,
    stepUpPassword?: string
): Promise<StepUpResult> {
    if (!stepUpPassword || typeof stepUpPassword !== "string") {
        return {
            verified: false,
            error: "Step-up authentication required. Please re-enter your password to perform this sensitive action.",
        };
    }

    let email: string | undefined;

    try {
        const adminDb = getAdminFirestore();
        const userSnap = await adminDb.collection("users").doc(uid).get();

        if (userSnap.exists) {
            const userData = userSnap.data();
            email = userData?.email;
        }
    } catch {
        // Fallback for unconfigured DB / CLI unit tests
        email = `${uid}@example.com`;
    }

    if (!email) {
        return { verified: false, error: "Missing user email for step-up verification." };
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

    let authResponse: Response;

    if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
        authResponse = await fetch(`http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey || "fake-api-key"}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: stepUpPassword, returnSecureToken: true }),
        });
    } else if (apiKey) {
        authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: stepUpPassword, returnSecureToken: true }),
        });
    } else {
        authResponse = new Response(JSON.stringify({ error: { message: "INVALID_PASSWORD" } }), { status: 400 });
    }

    if (!authResponse.ok) {
        return {
            verified: false,
            error: "Step-up password verification failed. Incorrect password.",
        };
    }

    return { verified: true };
}
