import { NextResponse } from "next/server";
import {
    processGracePeriodExpiry,
    expireGraceTeamsForEvent,
    expireStandardInvitationsForEvent
} from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { teamId, eventId } = body;

        if (!teamId && !eventId) {
            return NextResponse.json(
                { success: false, error: "Either teamId or eventId is required." },
                { status: 400 }
            );
        }

        if (eventId) {
            const [graceResult, inviteResult] = await Promise.all([
                expireGraceTeamsForEvent(eventId),
                expireStandardInvitationsForEvent(eventId),
            ]);

            return NextResponse.json({
                success: true,
                data: {
                    expiredGraceTeams: graceResult.data,
                    expiredStandardInvites: inviteResult.data,
                },
            });
        }

        if (teamId) {
            const result = await processGracePeriodExpiry(teamId);
            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, data: result.data });
        }

        return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
    } catch (error) {
        console.error("[API check-expiry] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}

