import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { cancelReplacementInvite } from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller) {
            return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json();
        const { teamId } = body;

        if (!teamId) {
            return NextResponse.json({ success: false, error: "teamId is required." }, { status: 400 });
        }

        const result = await cancelReplacementInvite(teamId, caller.uid);
        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
        console.error("[API cancel-replacement-invite] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
