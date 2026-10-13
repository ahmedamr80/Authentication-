import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { cancelIndividualEvent } from "@/lib/individual/individualRegistrationService";
import { cancelTeamEvent } from "@/lib/teams/teamRegistrationService";
import { normalizeEventDoc } from "@/lib/events/registrationUtils";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller || !caller.isAdmin) {
            return NextResponse.json({ success: false, error: "Forbidden: Admin access required." }, { status: 403 });
        }

        const body = await request.json();
        const { eventId, cancellationMessage } = body;

        if (!eventId) {
            return NextResponse.json({ success: false, error: "eventId is required." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const eventSnap = await db.collection("events").doc(eventId).get();
        if (!eventSnap.exists) {
            return NextResponse.json({ success: false, error: "Event not found." }, { status: 404 });
        }

        const eventMeta = normalizeEventDoc(eventSnap.data() || {});

        if (eventMeta.unitType === "players") {
            const result = await cancelIndividualEvent(eventId, cancellationMessage);
            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, data: result.data });
        } else {
            const result = await cancelTeamEvent(eventId, cancellationMessage);
            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, data: result.data });
        }
    } catch (error) {
        console.error("[API event cancel] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
