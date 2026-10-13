import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { registerSoloTeamEvent } from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller) {
            return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json();
        const { eventId, targetUid } = body;

        if (!eventId) {
            return NextResponse.json({ success: false, error: "eventId is required." }, { status: 400 });
        }

        const effectiveUid = (caller.isAdmin && targetUid) ? targetUid : caller.uid;
        const callerAuth = effectiveUid === caller.uid
            ? { emailVerified: caller.emailVerified, phoneNumber: caller.phoneNumber }
            : null;
        const result = await registerSoloTeamEvent(eventId, effectiveUid, callerAuth);

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
        console.error("[API register-solo] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
