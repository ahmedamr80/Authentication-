import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth/require-auth";

export const POST = withRole("admin", async (request, user) => {
    return NextResponse.json({
        success: true,
        message: "Admin endpoint accessed successfully.",
        requester: user.sub,
        role: user.role,
    });
});
