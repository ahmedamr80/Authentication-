import { NextResponse } from "next/server";
import { verifyPendingMFAToken, verifyTOTPCode, verifyAndConsumeBackupCode } from "@/lib/auth/mfa";
import { getAdminFirestore, getAdminAuth } from "@/lib/firebase-admin";
import { logAuthSecurityEvent } from "@/lib/auth/audit-logger";
import { issueAccessToken, issueRefreshToken, createRefreshTokenCookieHeader } from "@/lib/auth/tokens";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { pendingToken, code, isBackupCode } = body || {};

        if (!pendingToken || typeof pendingToken !== "string") {
            return NextResponse.json(
                { success: false, error: "MFA pending token is required." },
                { status: 400 }
            );
        }

        if (!code || typeof code !== "string") {
            return NextResponse.json(
                { success: false, error: "MFA verification code is required." },
                { status: 400 }
            );
        }

        // 1. Verify Ephemeral Pending MFA Token (5-min TTL & signature check)
        const payload = verifyPendingMFAToken(pendingToken);
        if (!payload) {
            return NextResponse.json(
                { success: false, error: "MFA session expired or invalid. Please sign in again with your password." },
                { status: 401 }
            );
        }

        const { uid, email } = payload;
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const userAgent = request.headers.get("user-agent") || "unknown";

        const adminDb = getAdminFirestore();
        const userDocRef = adminDb.collection("users").doc(uid);
        const userSnap = await userDocRef.get();

        if (!userSnap.exists) {
            return NextResponse.json({ success: false, error: "User account not found." }, { status: 400 });
        }

        const userData = userSnap.data();

        // 2. Backup Code Path
        if (isBackupCode) {
            const isValidBackup = await verifyAndConsumeBackupCode(uid, code);
            if (!isValidBackup) {
                await logAuthSecurityEvent("LOGIN_FAILED", ip, email, userAgent, { stage: "BACKUP_CODE_FAILED" });
                return NextResponse.json(
                    { success: false, error: "Invalid or previously used backup code." },
                    { status: 400 }
                );
            }
        } else {
            // 3. TOTP Code Path
            const mfaSecret = userData?.mfa_secret;
            if (!mfaSecret) {
                return NextResponse.json({ success: false, error: "MFA is not configured for this account." }, { status: 400 });
            }

            const isValidTotp = verifyTOTPCode(mfaSecret, code.trim());
            if (!isValidTotp) {
                await logAuthSecurityEvent("LOGIN_FAILED", ip, email, userAgent, { stage: "TOTP_FAILED" });
                return NextResponse.json(
                    { success: false, error: "Invalid 6-digit authenticator code." },
                    { status: 400 }
                );
            }
        }

        // 4. Verification Successful! Issue Access Token + HttpOnly Refresh Cookie
        const adminAuth = getAdminAuth();
        const customToken = await adminAuth.createCustomToken(uid);

        const accessToken = issueAccessToken({
            uid,
            email,
            role: userData?.role || "player",
            isAdmin: userData?.role === "admin" || userData?.isAdmin === true,
            is_email_verified: userData?.is_email_verified ?? true,
        });

        const { refreshToken } = issueRefreshToken(uid);
        const cookieHeader = createRefreshTokenCookieHeader(refreshToken);

        await logAuthSecurityEvent("LOGIN_SUCCESS", ip, email, userAgent, {
            mfaVerified: true,
            method: isBackupCode ? "BACKUP_CODE" : "TOTP",
        });

        const response = NextResponse.json({
            success: true,
            customToken,
            accessToken, // Access Token returned for in-memory JS state storage only!
            uid,
            message: "MFA challenge verified successfully.",
        });

        response.headers.set("Set-Cookie", cookieHeader);
        return response;
    } catch (error) {
        console.error("Error in MFA verify API route:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred during MFA verification." },
            { status: 500 }
        );
    }
}
