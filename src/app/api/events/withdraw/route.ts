import { NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyAccessToken } from "@/lib/auth/tokens";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, error: "Missing or invalid authorization header." },
                { status: 401 }
            );
        }

        const token = authHeader.substring(7).trim();
        let callerUid: string | null = null;
        let callerIsAdmin = false;

        // Authenticate caller
        try {
            const adminAuth = getAdminAuth();
            const decodedFirebaseToken = await adminAuth.verifyIdToken(token);
            callerUid = decodedFirebaseToken.uid;
            callerIsAdmin = !!decodedFirebaseToken.admin || decodedFirebaseToken.role === "admin";
        } catch {
            try {
                const decodedCustomToken = await verifyAccessToken(token);
                callerUid = decodedCustomToken.sub;
                callerIsAdmin = !!decodedCustomToken.isAdmin || decodedCustomToken.role === "admin";
            } catch {
                return NextResponse.json(
                    { success: false, error: "Unauthorized: Invalid token." },
                    { status: 401 }
                );
            }
        }

        if (!callerUid) {
            return NextResponse.json(
                { success: false, error: "Unauthorized." },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { eventId, targetUid } = body;

        if (!eventId) {
            return NextResponse.json(
                { success: false, error: "eventId is required." },
                { status: 400 }
            );
        }

        const effectiveUid = (callerIsAdmin && targetUid) ? targetUid : callerUid;
        const adminDb = getAdminFirestore();

        console.log(`[API Withdraw] Withdrawing user ${effectiveUid} from event ${eventId}`);

        // 1. Find all active registrations for this user in this event
        const regSnap1 = await adminDb.collection("registrations")
            .where("eventId", "==", eventId)
            .where("playerId", "==", effectiveUid)
            .get();

        const regSnap2 = await adminDb.collection("registrations")
            .where("eventId", "==", eventId)
            .where("player2Id", "==", effectiveUid)
            .get();

        const regDocs = [...regSnap1.docs, ...regSnap2.docs];
        let updatedCount = 0;

        for (const doc of regDocs) {
            const data = doc.data();
            if (data.status !== "CANCELLED") {
                if (data.playerId === effectiveUid) {
                    await doc.ref.update({
                        status: "CANCELLED",
                        cancelledAt: new Date(),
                        lookingForPartner: false,
                        partnerStatus: "CANCELLED",
                    });
                    updatedCount++;
                } else if (data.player2Id === effectiveUid) {
                    await doc.ref.update({
                        player2Id: null,
                        fullNameP2: null,
                        player2Confirmed: false,
                        lookingForPartner: true,
                        partnerStatus: "NONE",
                    });
                    updatedCount++;
                }
            }
        }

        // 2. Delete any matching team document in teams collection
        const teamSnap1 = await adminDb.collection("teams")
            .where("eventId", "==", eventId)
            .where("player1Id", "==", effectiveUid)
            .get();

        const teamSnap2 = await adminDb.collection("teams")
            .where("eventId", "==", eventId)
            .where("player2Id", "==", effectiveUid)
            .get();

        const teamDocs = [...teamSnap1.docs, ...teamSnap2.docs];
        for (const tDoc of teamDocs) {
            await tDoc.ref.delete().catch(() => {});
        }

        // 3. Decrement registrationsCount on event if applicable
        try {
            const eventDoc = await adminDb.collection("events").doc(eventId).get();
            if (eventDoc.exists) {
                const eventData = eventDoc.data();
                const currentCount = eventData?.registrationsCount || 0;
                if (currentCount > 0 && updatedCount > 0) {
                    await eventDoc.ref.update({
                        registrationsCount: Math.max(0, currentCount - 1),
                    });
                }
            }
        } catch (e) {
            console.warn("[API Withdraw] Non-blocking event count update error:", e);
        }

        return NextResponse.json({
            success: true,
            updatedCount,
            message: "User status updated to CANCELLED.",
        });
    } catch (error) {
        console.error("[API Withdraw] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
