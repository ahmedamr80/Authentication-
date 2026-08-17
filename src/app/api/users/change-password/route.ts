import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/require-auth";
import { verifyStepUpAuthentication } from "@/lib/auth/step-up";
import { validatePasswordSecurity } from "@/lib/auth/password-security";

export const POST = withApiAuth(async (request, user) => {
    try {
        const body = await request.json();
        const { currentPassword, newPassword } = body || {};

        // STEP-UP AUTHENTICATION MANDATE: Sensitive mid-session operations require password re-authentication!
        const stepUpResult = await verifyStepUpAuthentication(user.sub, currentPassword);

        if (!stepUpResult.verified) {
            return NextResponse.json(
                {
                    success: false,
                    error: stepUpResult.error || "Step-up authentication failed.",
                    stepUpRequired: true,
                },
                { status: 401 }
            );
        }

        // Validate new password security policy & breach database
        const passwordVal = await validatePasswordSecurity(newPassword);
        if (!passwordVal.valid) {
            return NextResponse.json({ success: false, error: passwordVal.error }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            message: "Password changed successfully after step-up re-authentication.",
        });
    } catch (error) {
        console.error("Error in change-password route:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
});
