import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { getAdminFirestore } from "@/lib/firebase-admin";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ eventId: string }> }
) {
    try {
        const { eventId } = await params;
        if (!eventId) {
            return NextResponse.json({ success: false, error: "eventId is required." }, { status: 400 });
        }

        const caller = await resolveUserFromRequest(request);
        if (!caller || !caller.isAdmin) {
            return NextResponse.json({ success: false, error: "Forbidden: Admin access required." }, { status: 403 });
        }

        const db = getAdminFirestore();
        const snapshot = await db
            .collection("auditLogs")
            .where("eventId", "==", eventId)
            .get();

        const logs = snapshot.docs.map((d) => ({
            auditId: d.id,
            ...d.data(),
        }));

        return NextResponse.json({ success: true, logs });
    } catch (error) {
        console.error("[API audit logs GET] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
