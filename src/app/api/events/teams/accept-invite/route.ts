import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { acceptTeamInvitation } from "@/lib/teams/teamRegistrationService";

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

        const callerAuth = { emailVerified: caller.emailVerified, phoneNumber: caller.phoneNumber };
        const result = await acceptTeamInvitation(teamId, caller.uid, callerAuth);
        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
        console.error("[API accept-invite] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
