import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
    verifyAccessToken,
    verifyRefreshToken,
    createClearRefreshTokenCookieHeader,
} from "@/lib/auth/tokens";
import { revokeJti } from "@/lib/auth/jti-revocation";
import { revokeSessionFamily } from "@/lib/auth/session-family";
import { logAuthSecurityEvent } from "@/lib/auth/audit-logger";

export async function POST(request: Request) {
    try {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const userAgent = request.headers.get("user-agent") || "unknown";

        // 1. Revoke Access Token JTI if Bearer token present
        const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
        let uid = "unknown";

        if (authHeader && authHeader.startsWith("Bearer ")) {
            const rawToken = authHeader.substring(7).trim();
            try {
                const accessPayload = await verifyAccessToken(rawToken);
                uid = accessPayload.sub;
                await revokeJti(accessPayload.jti, accessPayload.exp);
            } catch {
                // Ignore expired access token error during logout
            }
        }

        // 2. Revoke Session Family Lineage if Refresh Cookie present
        const cookieStore = await cookies();
        const rawRefreshCookie =
            cookieStore.get("__Host-refreshtoken")?.value ||
            cookieStore.get("refreshtoken")?.value;

        if (rawRefreshCookie) {
            try {
                const refreshPayload = verifyRefreshToken(rawRefreshCookie);
                if (uid === "unknown") uid = refreshPayload.sub;
                await revokeSessionFamily(refreshPayload.tokenFamilyId, "USER_LOGOUT");
            } catch {
                // Ignore invalid refresh cookie error during logout
            }
        }

        // 3. Clear HttpOnly Refresh Cookie
        const response = NextResponse.json({
            success: true,
            message: "Logged out successfully.",
        });

        response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
        await logAuthSecurityEvent("LOGIN_SUCCESS", ip, uid, userAgent, { action: "LOGOUT" });

        return response;
    } catch (error) {
        console.error("Error in logout API route:", error);
        const response = NextResponse.json({ success: true, message: "Logged out." });
        response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
        return response;
    }
}
