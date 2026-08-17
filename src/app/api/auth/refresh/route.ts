import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import {
    verifyRefreshToken,
    issueAccessToken,
    issueRefreshToken,
    createRefreshTokenCookieHeader,
    createClearRefreshTokenCookieHeader,
} from "@/lib/auth/tokens";
import { rotateSessionFamilyToken } from "@/lib/auth/session-family";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { logAuthSecurityEvent } from "@/lib/auth/audit-logger";

export async function POST(request: Request) {
    try {
        const cookieStore = await cookies();
        const rawCookie =
            cookieStore.get("__Host-refreshtoken")?.value ||
            cookieStore.get("refreshtoken")?.value;

        if (!rawCookie) {
            return NextResponse.json(
                { success: false, error: "Refresh token cookie missing." },
                { status: 401 }
            );
        }

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const userAgent = request.headers.get("user-agent") || "unknown";

        // 1. Validate Refresh Token Signature & Expiry
        let payload;
        try {
            payload = verifyRefreshToken(rawCookie);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Invalid refresh token";
            const response = NextResponse.json({ success: false, error: msg }, { status: 401 });
            response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
            return response;
        }

        const { sub: uid, tokenFamilyId, jti } = payload;
        const newJti = crypto.randomBytes(16).toString("hex");

        // 2. Rotate Token & Perform Reuse / Expiry Checks
        const rotationResult = await rotateSessionFamilyToken(tokenFamilyId, jti, newJti);

        if (!rotationResult.success) {
            if (rotationResult.familyRevoked) {
                await logAuthSecurityEvent("LOCKOUT_TRIGGERED", ip, uid, userAgent, {
                    reason: rotationResult.error || "REFRESH_TOKEN_REUSE_DETECTED",
                });
            }

            const response = NextResponse.json(
                { success: false, error: rotationResult.error || "Failed to refresh token." },
                { status: 401 }
            );
            response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
            return response;
        }

        // 3. Fetch User Data to Issue Updated Access Token
        const adminDb = getAdminFirestore();
        const userDoc = await adminDb.collection("users").doc(uid).get();
        const userData = userDoc.data() || {};

        const newAccessToken = issueAccessToken({
            uid,
            email: userData.email || "",
            role: userData.role || "player",
            isAdmin: userData.role === "admin" || userData.isAdmin === true,
            is_email_verified: userData.is_email_verified ?? true,
        });

        // 4. Issue Brand-New Rotated Refresh Token under Same Family
        const { refreshToken: newRefreshToken } = issueRefreshToken(uid, tokenFamilyId);
        const newCookieHeader = createRefreshTokenCookieHeader(newRefreshToken);

        const response = NextResponse.json({
            success: true,
            accessToken: newAccessToken, // In-memory JS state access token
            message: "Token refreshed successfully.",
        });

        // Set rotated HttpOnly cookie in response headers
        response.headers.set("Set-Cookie", newCookieHeader);
        return response;
    } catch (error) {
        console.error("Error in refresh API route:", error);
        const response = NextResponse.json(
            { success: false, error: "An unexpected error occurred during silent refresh." },
            { status: 500 }
        );
        response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
        return response;
    }
}

export async function GET(request: Request) {
    return POST(request);
}
