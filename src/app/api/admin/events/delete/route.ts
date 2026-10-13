import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import admin from "firebase-admin";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller || !caller.isAdmin) {
            return NextResponse.json(
                { success: false, error: "Forbidden: Admin access required." },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { eventIds } = body;

        if (!Array.isArray(eventIds) || eventIds.length === 0) {
            return NextResponse.json(
                { success: false, error: "eventIds must be a non-empty array." },
                { status: 400 }
            );
        }

        const db = getAdminFirestore();
        const now = new Date();
        const deletedEventsSummary: {
            id: string;
            name: string;
            isUpcoming: boolean;
            notificationsSent: number;
            deletedRegistrations: number;
            deletedTeams: number;
            deletedNotifications: number;
            deletedAuditLogs: number;
        }[] = [];

        for (const eventId of eventIds) {
            if (!eventId || typeof eventId !== "string") continue;

            const eventRef = db.collection("events").doc(eventId);
            const eventSnap = await eventRef.get();
            if (!eventSnap.exists) {
                continue;
            }

            const eventData = eventSnap.data() || {};
            const eventName = eventData.eventName || eventData.title || "Padel Event";

            // Determine if the event is upcoming
            const dtRaw = eventData.dateTime || eventData.eventDate || eventData.eventStartAt;
            let eventDate: Date | null = null;
            if (dtRaw) {
                if (typeof dtRaw.toDate === "function") {
                    eventDate = dtRaw.toDate();
                } else if (dtRaw._seconds) {
                    eventDate = new Date(dtRaw._seconds * 1000);
                } else if (dtRaw.seconds) {
                    eventDate = new Date(dtRaw.seconds * 1000);
                } else if (dtRaw instanceof Date) {
                    eventDate = dtRaw;
                } else if (typeof dtRaw === "string" || typeof dtRaw === "number") {
                    const parsed = new Date(dtRaw);
                    if (!isNaN(parsed.getTime())) eventDate = parsed;
                }
            }

            const durationMinutes = Number(eventData.duration) || 60;
            const endDate = eventDate ? new Date(eventDate.getTime() + durationMinutes * 60000) : null;
            // Event is upcoming if end date has not passed yet, or if start date is in the future
            const isUpcoming = endDate
                ? endDate.getTime() >= now.getTime()
                : (eventDate ? eventDate.getTime() >= now.getTime() : false);

            // 1. Identify all registrations
            const regsSnap = await db.collection("registrations").where("eventId", "==", eventId).get();
            const playerIds = new Set<string>();

            regsSnap.docs.forEach((doc) => {
                const data = doc.data();
                if (data.playerId) playerIds.add(String(data.playerId));
                if (data.player2Id) playerIds.add(String(data.player2Id));
            });

            // 2. Identify all teams
            const teamsSnap = await db.collection("teams").where("eventId", "==", eventId).get();
            teamsSnap.docs.forEach((doc) => {
                const data = doc.data();
                if (data.player1Id) playerIds.add(String(data.player1Id));
                if (data.player2Id) playerIds.add(String(data.player2Id));
            });

            // 3. Identify all existing notifications related to this event
            const notifsSnap = await db.collection("notifications").where("eventId", "==", eventId).get();

            // 4. Identify all audit logs related to this event (check auditLogs and auditlogs)
            const auditLogsSnap = await db.collection("auditLogs").where("eventId", "==", eventId).get();
            const auditLogsLowerSnap = await db.collection("auditlogs").where("eventId", "==", eventId).get();

            // 5. Batch deletions and notifications
            let batch = db.batch();
            let opCount = 0;

            const commitIfNeeded = async () => {
                if (opCount >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    opCount = 0;
                }
            };

            // 6. Delete all existing related notifications
            for (const notifDoc of notifsSnap.docs) {
                batch.delete(notifDoc.ref);
                opCount++;
                await commitIfNeeded();
            }

            // 7. Delete all related audit logs
            for (const auditDoc of auditLogsSnap.docs) {
                batch.delete(auditDoc.ref);
                opCount++;
                await commitIfNeeded();
            }
            for (const auditDoc of auditLogsLowerSnap.docs) {
                batch.delete(auditDoc.ref);
                opCount++;
                await commitIfNeeded();
            }

            // 8. Delete registrations
            for (const regDoc of regsSnap.docs) {
                batch.delete(regDoc.ref);
                opCount++;
                await commitIfNeeded();
            }

            // 9. Delete teams
            for (const teamDoc of teamsSnap.docs) {
                batch.delete(teamDoc.ref);
                opCount++;
                await commitIfNeeded();
            }

            // 10. Delete event document
            batch.delete(eventRef);
            opCount++;
            await commitIfNeeded();

            // 11. Send cancellation notice ONLY for upcoming events to alert registered players
            let notificationsSent = 0;
            if (isUpcoming && playerIds.size > 0) {
                const dateStr = eventDate
                    ? eventDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "";
                const notifMessage = dateStr
                    ? `The event "${eventName}" scheduled for ${dateStr} has been deleted by the administrator.`
                    : `The event "${eventName}" has been deleted by the administrator.`;

                for (const playerId of Array.from(playerIds)) {
                    const notifRef = db.collection("notifications").doc();
                    batch.set(notifRef, {
                        notificationId: notifRef.id,
                        userId: playerId,
                        type: "EVENT_DELETED",
                        title: "Event Deleted",
                        message: notifMessage,
                        eventName: eventName,
                        deletedEventId: eventId,
                        read: false,
                        createdAt: admin.firestore.Timestamp.now(),
                    });
                    opCount++;
                    notificationsSent++;
                    await commitIfNeeded();
                }
            }

            // Commit remaining operations
            if (opCount > 0) {
                await batch.commit();
            }

            deletedEventsSummary.push({
                id: eventId,
                name: eventName,
                isUpcoming,
                notificationsSent,
                deletedRegistrations: regsSnap.size,
                deletedTeams: teamsSnap.size,
                deletedNotifications: notifsSnap.size,
                deletedAuditLogs: auditLogsSnap.size + auditLogsLowerSnap.size,
            });
        }

        return NextResponse.json({
            success: true,
            deletedCount: deletedEventsSummary.length,
            events: deletedEventsSummary,
        });
    } catch (error) {
        console.error("[API delete events] Error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Internal server error occurred.",
            },
            { status: 500 }
        );
    }
}
