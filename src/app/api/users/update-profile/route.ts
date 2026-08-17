import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/require-auth";
import { isResourceOwner } from "@/lib/auth/rbac-abac";

export const POST = withApiAuth(async (request, user) => {
    try {
        const body = await request.json();
        const { targetUid, fullName } = body || {};

        if (!targetUid || typeof targetUid !== "string") {
            return NextResponse.json({ success: false, error: "targetUid is required." }, { status: 400 });
        }

        // ABAC OWNERSHIP CHECK: User A cannot modify User B's resource!
        const canModify = isResourceOwner(user.sub, targetUid, user.isAdmin);

        if (!canModify) {
            return NextResponse.json(
                { success: false, error: "Forbidden: You cannot modify another user's profile resource." },
                { status: 403 }
            );
        }

        return NextResponse.json({
            success: true,
            targetUid,
            updatedBy: user.sub,
            fullName,
            message: "Profile resource updated successfully.",
        });
    } catch (error) {
        console.error("Error in update-profile route:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
});
