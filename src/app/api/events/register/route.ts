import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { registerIndividualPlayer } from "@/lib/individual/individualRegistrationService";
import { registerSoloTeamEvent } from "@/lib/teams/teamRegistrationService";
import { normalizeEventDoc } from "@/lib/events/registrationUtils";

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

        const db = getAdminFirestore();
        const eventSnap = await db.collection("events").doc(eventId).get();
        if (!eventSnap.exists) {
            return NextResponse.json({ success: false, error: "Event not found." }, { status: 404 });
        }

        const eventMeta = normalizeEventDoc(eventSnap.data() || {});

        const callerAuth = effectiveUid === caller.uid
            ? { emailVerified: caller.emailVerified, phoneNumber: caller.phoneNumber }
            : null;

        if (eventMeta.unitType === "players") {
            const result = await registerIndividualPlayer(eventId, effectiveUid, callerAuth);
            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, data: result.data });
        } else {
            const result = await registerSoloTeamEvent(eventId, effectiveUid, callerAuth);
            if (!result.success) {
                return NextResponse.json({ success: false, error: result.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, data: result.data });
        }
    } catch (error) {
        console.error("[API register] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
