import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { clearPlayerRedFlag } from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller || !caller.isAdmin) {
            return NextResponse.json({ success: false, error: "Forbidden: Admin access required." }, { status: 403 });
        }

        const body = await request.json();
        const { targetUid } = body;

        if (!targetUid) {
            return NextResponse.json({ success: false, error: "targetUid is required." }, { status: 400 });
        }

        const result = await clearPlayerRedFlag(targetUid);
        return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
        console.error("[API clear-redflag] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
