import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/require-auth";
import { verifyStepUpAuthentication } from "@/lib/auth/step-up";
import { performAccountDeletion } from "@/lib/auth/account-deletion";
import { createClearRefreshTokenCookieHeader } from "@/lib/auth/tokens";

export const POST = withApiAuth(async (request, user) => {
    try {
        const body = await request.json();
        const { stepUpPassword, confirmPhrase } = body || {};

        const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
        const userAgent = request.headers.get("user-agent") || "unknown";

        // 1. STEP-UP RE-AUTHENTICATION MANDATE: Require current password re-verification!
        const stepUpResult = await verifyStepUpAuthentication(user.sub, stepUpPassword);

        if (!stepUpResult.verified) {
            return NextResponse.json(
                {
                    success: false,
                    error: stepUpResult.error || "Step-up password authentication required to delete account.",
                    stepUpRequired: true,
                },
                { status: 401 }
            );
        }

        // 2. Explicit Confirmation Phrase Check
        if (confirmPhrase !== "DELETE MY ACCOUNT") {
            return NextResponse.json(
                {
                    success: false,
                    error: "Explicit confirmation phrase 'DELETE MY ACCOUNT' is required.",
                },
                { status: 400 }
            );
        }

        // 3. Cascade Account Deletion (Apple revocation, Firestore PII wipe, Auth deletion, Session revocation)
        const deletionResult = await performAccountDeletion(user.sub, ip, userAgent);

        if (!deletionResult.success) {
            return NextResponse.json(
                { success: false, error: deletionResult.error || "Account deletion failed." },
                { status: 500 }
            );
        }

        const response = NextResponse.json({
            success: true,
            appleRevoked: deletionResult.appleRevoked,
            message: "Your account and all associated personal data have been permanently deleted.",
        });

        // 4. Clear Auth Cookies
        response.headers.set("Set-Cookie", createClearRefreshTokenCookieHeader());
        return response;
    } catch (error) {
        console.error("Error in delete-account API route:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred during account deletion." },
            { status: 500 }
        );
    }
});
