import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/require-auth";
import { revokeJti, revokeAllUserSessions } from "@/lib/auth/jti-revocation";
import { createClearRefreshTokenCookieHeader } from "@/lib/auth/tokens";
import { logAuthSecurityEvent } from "@/lib/auth/audit-logger";

export const POST = withApiAuth(async (request, user) => {
    try {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const userAgent = request.headers.get("user-agent") || "unknown";

        // 1. Revoke Current Access Token JTI
        await revokeJti(user.jti, user.exp);

        // 2. Revoke ALL Active Session Families for this User UID (Sign Out All Devices!)
        const revokedCount = await revokeAllUserSessions(user.sub, "GLOBAL_SIGN_OUT");

        await logAuthSecurityEvent("LOCKOUT_TRIGGERED", ip, user.sub, userAgent, {
            action: "GLOBAL_SIGN_OUT",
            revokedSessionsCount: revokedCount,
        });

        const response = NextResponse.json({
            success: true,
            revokedSessionsCount: revokedCount,
            message: "All active sessions have been signed out across all devices.",
        });

        // 3. Clear HttpOnly Refresh Cookie
        response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
        return response;
    } catch (error) {
        console.error("Error in logout-all API route:", error);
        return NextResponse.json({ success: false, error: "Failed to perform global sign out." }, { status: 500 });
    }
});
