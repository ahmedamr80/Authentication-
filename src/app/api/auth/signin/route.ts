import { NextResponse } from "next/server";
import { checkBruteForceStatus, recordFailedAttempt, resetFailedAttempts } from "@/lib/auth/brute-force";
import { logAuthSecurityEvent } from "@/lib/auth/audit-logger";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { createPendingMFAToken } from "@/lib/auth/mfa";
import { issueAccessToken, issueRefreshToken, createRefreshTokenCookieHeader } from "@/lib/auth/tokens";

export async function POST(request: Request) {
    const startTime = Date.now();

    try {
        const body = await request.json();
        const { email, password, captchaToken } = body || {};

        if (!email || !password || typeof email !== "string" || typeof password !== "string") {
            return NextResponse.json(
                { success: false, error: "Invalid email or password." },
                { status: 400 }
            );
        }

        const normalizedEmail = email.trim().toLowerCase();
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const userAgent = request.headers.get("user-agent") || "unknown";

        // 1. Check Brute-Force Status
        const bfStatus = await checkBruteForceStatus(ip, normalizedEmail);

        if (bfStatus.lockedOut) {
            await logAuthSecurityEvent("LOCKOUT_TRIGGERED", ip, normalizedEmail, userAgent, {
                attempts: bfStatus.failedAttemptsCount,
            });

            return NextResponse.json(
                {
                    success: false,
                    error: bfStatus.reason || "Account temporarily locked due to multiple failed sign-in attempts.",
                    lockedOut: true,
                },
                { status: 429 }
            );
        }

        if (bfStatus.requireCaptcha && !captchaToken) {
            await logAuthSecurityEvent("CAPTCHA_REQUIRED", ip, normalizedEmail, userAgent, {
                attempts: bfStatus.failedAttemptsCount,
            });

            return NextResponse.json(
                {
                    success: false,
                    error: "CAPTCHA verification required after multiple failed attempts.",
                    requireCaptcha: true,
                },
                { status: 400 }
            );
        }

        // 2. Authenticate Password via Firebase Auth REST API
        const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
        const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

        let authResponse: Response;

        if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
            authResponse = await fetch(`http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey || "fake-api-key"}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: normalizedEmail,
                    password,
                    returnSecureToken: true,
                }),
            });
        } else if (apiKey) {
            authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: normalizedEmail,
                    password,
                    returnSecureToken: true,
                }),
            });
        } else {
            authResponse = new Response(JSON.stringify({ error: { message: "INVALID_PASSWORD" } }), { status: 400 });
        }

        const authData = await authResponse.json();

        // 3. Handle Authentication Failure
        if (!authResponse.ok || authData.error) {
            await recordFailedAttempt(ip, normalizedEmail);
            await logAuthSecurityEvent("LOGIN_FAILED", ip, normalizedEmail, userAgent);

            const elapsedTime = Date.now() - startTime;
            if (elapsedTime < 300) {
                await new Promise((resolve) => setTimeout(resolve, 300 - elapsedTime));
            }

            return NextResponse.json(
                { success: false, error: "Invalid email or password." },
                { status: 401 }
            );
        }

        // 4. Password Passed! Check MFA & Session Token Issuance
        const uid = authData.localId;
        const adminDb = getAdminFirestore();
        const userDoc = await adminDb.collection("users").doc(uid).get();
        const userData = userDoc.data() || {};

        if (userData.mfa_enabled === true) {
            // Partial Session Gating: Issue 5-min pending MFA token
            const pendingToken = createPendingMFAToken(uid, normalizedEmail);
            await resetFailedAttempts(ip, normalizedEmail);

            await logAuthSecurityEvent("CAPTCHA_REQUIRED", ip, normalizedEmail, userAgent, {
                stage: "MFA_CHALLENGE_PENDING",
            });

            return NextResponse.json({
                success: true,
                requireMfa: true,
                pendingToken,
                mfaType: userData.mfa_type || "totp",
                message: "MFA challenge required to complete sign-in.",
            });
        }

        // 5. Successful Authentication -> Issue Access Token (in-memory) & Set HttpOnly Refresh Cookie
        const accessToken = issueAccessToken({
            uid,
            email: normalizedEmail,
            role: userData.role || "player",
            isAdmin: userData.role === "admin" || userData.isAdmin === true,
            is_email_verified: userData.is_email_verified ?? true,
        });

        const { refreshToken, familyId, jti } = issueRefreshToken(uid);
        const { createSessionFamily } = await import("@/lib/auth/session-family");
        await createSessionFamily(uid, familyId, jti);

        const cookieHeader = createRefreshTokenCookieHeader(refreshToken);

        await resetFailedAttempts(ip, normalizedEmail);
        await logAuthSecurityEvent("LOGIN_SUCCESS", ip, normalizedEmail, userAgent);

        const elapsedTime = Date.now() - startTime;
        if (elapsedTime < 300) {
            await new Promise((resolve) => setTimeout(resolve, 300 - elapsedTime));
        }

        const response = NextResponse.json({
            success: true,
            requireMfa: false,
            promptMfaEnrollment: userData.role === "admin" || userData.isAdmin === true,
            accessToken, // Access Token returned for in-memory JS state storage only!
            localId: uid,
            message: "Signed in successfully.",
        });

        // Set HttpOnly, Secure, SameSite=Strict refresh cookie in HTTP response headers
        response.headers.set("Set-Cookie", cookieHeader);
        return response;
    } catch (error) {
        console.error("Error in signin API route:", error);
        return NextResponse.json(
            { success: false, error: "Invalid email or password." },
            { status: 401 }
        );
    }
}
