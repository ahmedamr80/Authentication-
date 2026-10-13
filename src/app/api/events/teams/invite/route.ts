import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { sendTeamInvitation } from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller) {
            return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json();
        const { eventId, inviteeId } = body;

        if (!eventId || !inviteeId) {
            return NextResponse.json(
                { success: false, error: "eventId and inviteeId are required." },
                { status: 400 }
            );
        }

        const callerAuth = { emailVerified: caller.emailVerified, phoneNumber: caller.phoneNumber };
        const result = await sendTeamInvitation(eventId, caller.uid, inviteeId, callerAuth);
        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
        console.error("[API team invite] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
