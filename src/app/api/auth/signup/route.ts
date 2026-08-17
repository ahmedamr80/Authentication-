import { NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { validatePasswordSecurity } from "@/lib/auth/password-security";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { generateVerificationToken, VERIFICATION_TOKEN_TTL_MS } from "@/lib/auth/verification-token";

export async function POST(request: Request) {
    const startTime = Date.now();

    try {
        const body = await request.json();
        const { email, password, fullName } = body || {};

        if (!email || typeof email !== "string" || !/\S+@\S+\.\S+/.test(email)) {
            return NextResponse.json({ success: false, error: "Valid email address is required." }, { status: 400 });
        }

        if (!password || typeof password !== "string" || password.length < 8) {
            return NextResponse.json({ success: false, error: "Password must be at least 8 characters." }, { status: 400 });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Rate limiting by IP and Email
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const ipRate = checkRateLimit(`signup:ip:${ip}`, { windowMs: 60 * 1000, maxAttempts: 5 });
        const emailRate = checkRateLimit(`signup:email:${normalizedEmail}`, { windowMs: 60 * 1000, maxAttempts: 5 });

        if (!ipRate.allowed || !emailRate.allowed) {
            return NextResponse.json(
                { success: false, error: "Too many sign-up attempts. Please wait a moment before trying again." },
                { status: 429 }
            );
        }

        // Validate password security
        const passwordValidation = await validatePasswordSecurity(password);
        if (!passwordValidation.valid) {
            return NextResponse.json({ success: false, error: passwordValidation.error }, { status: 400 });
        }

        const adminAuth = getAdminAuth();
        const adminDb = getAdminFirestore();

        // 1. Check if user already exists in Firebase Auth
        let existingAuthUser = null;
        try {
            existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
        } catch {
            existingAuthUser = null;
        }

        // 2. Check Firestore users collection for existing user / shadow profile
        const usersSnapshot = await adminDb.collection("users").where("email", "==", normalizedEmail).get();
        let existingFirestoreDoc: Record<string, unknown> | null = null;
        let shadowDoc: (Record<string, unknown> & { id: string }) | null = null;

        if (!usersSnapshot.empty) {
            for (const doc of usersSnapshot.docs) {
                const data = doc.data();
                if (data.isShadow === true) {
                    shadowDoc = { id: doc.id, ...data };
                } else {
                    existingFirestoreDoc = { id: doc.id, ...data };
                }
            }
        }

        // If user already exists in Firebase Auth OR has an active Firestore document:
        if (existingAuthUser || existingFirestoreDoc) {
            return NextResponse.json(
                {
                    success: false,
                    error: "An account with this email address already exists. Please sign in instead.",
                    code: "auth/email-already-in-use",
                },
                { status: 409 }
            );
        }

        // 3. Create the new user in Firebase Auth
        const userRecord = await adminAuth.createUser({
            email: normalizedEmail,
            password: password,
            displayName: fullName || "",
            emailVerified: false,
        });

        // 4. Create or Claim User Document in Firestore
        const userDocRef = adminDb.collection("users").doc(userRecord.uid);

        if (shadowDoc) {
            // Claim existing shadow profile
            const { id: shadowId, ...shadowData } = shadowDoc;
            await userDocRef.set({
                ...shadowData,
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: fullName || shadowData.fullName || "",
                isShadow: false,
                isAdmin: false,
                role: "player",
                registrationStatus: "active",
                claimedAt: new Date().toISOString(),
                previousUid: shadowId,
            });
            // Delete old shadow doc
            await adminDb.collection("users").doc(shadowId).delete();
        } else {
            // Create fresh user profile
            await userDocRef.set({
                uid: userRecord.uid,
                email: normalizedEmail,
                fullName: fullName || "",
                is_email_verified: false,
                registrationStatus: "active",
                role: "player",
                isAdmin: false,
                isShadow: false,
                createdAt: new Date().toISOString(),
            });
        }

        // Generate verification token
        try {
            const { rawToken, tokenHash } = generateVerificationToken();
            const expiresAt = Date.now() + VERIFICATION_TOKEN_TTL_MS;

            await adminDb.collection("verification_tokens").doc(tokenHash).set({
                tokenHash,
                uid: userRecord.uid,
                email: normalizedEmail,
                expiresAt,
                usedAt: null,
                createdAt: Date.now(),
            });

            const host = request.headers.get("host") || "localhost:5000";
            const protocol = host.includes("localhost") ? "http" : "https";
            const verificationLink = `${protocol}://${host}/auth/verify-email?token=${rawToken}`;
            console.log(`[AUTH-SECURITY] Verification link generated for ${normalizedEmail}: ${verificationLink}`);
        } catch (tokenErr) {
            console.warn("Failed to generate email verification token:", tokenErr);
        }

        return NextResponse.json(
            {
                success: true,
                message: "Account created successfully! Please sign in with your credentials.",
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        console.error("Error in signup API route:", error);
        const err = error as { code?: string; message?: string };
        if (err.code === "auth/email-already-exists") {
            return NextResponse.json(
                { success: false, error: "An account with this email address already exists. Please sign in instead." },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { success: false, error: err.message || "An unexpected error occurred during signup." },
            { status: 500 }
        );
    }
}
