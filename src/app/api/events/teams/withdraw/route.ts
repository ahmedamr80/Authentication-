import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { withdrawFromTeamEvent } from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller) {
            return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json();
        const { eventId, targetUid, confirmedLateWithdrawal } = body;

        if (!eventId) {
            return NextResponse.json({ success: false, error: "eventId is required." }, { status: 400 });
        }

        const effectiveUid = (caller.isAdmin && targetUid) ? targetUid : caller.uid;

        const result = await withdrawFromTeamEvent(eventId, effectiveUid, {
            confirmedLateWithdrawal: !!confirmedLateWithdrawal,
        });

        if (result.requiresConfirmation) {
            return NextResponse.json({
                success: false,
                requiresConfirmation: true,
                isLate: result.isLate,
                warningMessage: result.warningMessage,
            }, { status: 200 });
        }

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 });
        }

        return NextResponse.json({ success: true, data: result.data });
    } catch (error) {
        console.error("[API team withdraw] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
