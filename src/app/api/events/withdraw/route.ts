import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { withdrawIndividualPlayer } from "@/lib/individual/individualRegistrationService";
import { withdrawFromTeamEvent } from "@/lib/teams/teamRegistrationService";
import { normalizeEventDoc } from "@/lib/events/registrationUtils";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller) {
            return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json();
        const { eventId, targetUid, acknowledgePenalty, confirmedLateWithdrawal } = body;

        if (!eventId) {
            return NextResponse.json({ success: false, error: "eventId is required." }, { status: 400 });
        }

        const effectiveUid = (caller.isAdmin && targetUid) ? targetUid : caller.uid;

        const db = getAdminFirestore();
        const eventSnap = await db.collection("events").doc(eventId).get();
        if (!eventSnap.exists) {
            return NextResponse.json({ success: false, error: "Event not found." }, { status: 404 });
        }

        const eventMeta = normalizeEventDoc(eventSnap.data() || {});
        const confirmedLate = !!(acknowledgePenalty || confirmedLateWithdrawal);

        if (eventMeta.unitType === "players") {
            const result = await withdrawIndividualPlayer(eventId, effectiveUid, {
                acknowledgePenalty: confirmedLate,
            });

            if (result.requiresConfirmation || result.requiresAcknowledgment) {
                return NextResponse.json(
                    {
                        success: false,
                        requiresConfirmation: true,
                        requiresAcknowledgment: true,
                        isLate: result.isLate,
                        warningMessage: result.message || result.warningMessage,
                        message: result.message || result.warningMessage,
                    },
                    { status: 200 }
                );
            }

            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }

            return NextResponse.json({ success: true, data: result.data });
        } else {
            const result = await withdrawFromTeamEvent(eventId, effectiveUid, {
                confirmedLateWithdrawal: confirmedLate,
            });

            if (result.requiresConfirmation) {
                return NextResponse.json(
                    {
                        success: false,
                        requiresConfirmation: true,
                        requiresAcknowledgment: true,
                        isLate: result.isLate,
                        warningMessage: result.warningMessage,
                        message: result.warningMessage,
                    },
                    { status: 200 }
                );
            }

            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }

            return NextResponse.json({ success: true, data: result.data });
        }
    } catch (error) {
        console.error("[API withdraw] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
