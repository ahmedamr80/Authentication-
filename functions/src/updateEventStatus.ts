import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";

// Ensure admin is initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Shared logic to find upcoming events that are now past their start time
 * and update their status to "past".
 */
async function updatePastEvents() {
    const now = admin.firestore.Timestamp.now();

    // Query for events where status is "upcoming" and dateTime < now
    // This requires a composite index on status (ASC) + dateTime (ASC)
    const eventsRef = db.collection("events");
    const q = eventsRef
        .where("status", "==", "Upcoming") // Case-sensitive check
        .where("dateTime", "<", now);

    const snapshot = await q.get();

    logger.info(`Found ${snapshot.size} events to update.`);

    if (snapshot.empty) {
        return 0;
    }

    const batchSize = 500;
    let batch = db.batch();
    let opCounter = 0;
    let totalUpdated = 0;

    for (const doc of snapshot.docs) {
        batch.update(doc.ref, { status: "Past" });
        opCounter++;
        totalUpdated++;

        if (opCounter >= batchSize) {
            await batch.commit();
            logger.info(`Committed batch of ${opCounter} updates.`);
            batch = db.batch();
            opCounter = 0;
        }
    }

    if (opCounter > 0) {
        await batch.commit();
        logger.info(`Committed final batch of ${opCounter} updates.`);
    }

    return totalUpdated;
}

/**
 * Scheduled function that runs every week (Sunday at midnight).
 */
export const scheduledEventCleanup = onSchedule("every sunday 00:00", async (event) => {
    try {
        const count = await updatePastEvents();
        logger.info(`Scheduled event cleanup completed. Updated ${count} events.`);
    } catch (error) {
        logger.error("Error in scheduledEventCleanup:", error);
    }
});

/**
 * Callable function to be triggered manually from the frontend.
 */
export const manualEventCleanup = onCall({ cors: true }, async (request) => {
    // Optional: Add admin check here if you pass auth context
    // if (!request.auth || !request.auth.token.admin) {
    //     throw new HttpsError('permission-denied', 'Must be an admin to call this function.');
    // }

    try {
        const count = await updatePastEvents();
        return {
            message: "Events updated successfully",
            count: count
        };
    } catch (error) {
        logger.error("Error in manualEventCleanup:", error);
        throw new HttpsError("internal", "Failed to update events", error);
    }
});

/**
 * Callable function to recalculate and synchronize event registration counts.
 */
export const recalculateEventCounts = onCall({
    cors: true,
    timeoutSeconds: 300,
    memory: "512MiB"
}, async (request) => {
    logger.info("Starting recalculateEventCounts...");
    try {
        const eventsSnapshot = await db.collection("events").get();
        if (eventsSnapshot.empty) {
            logger.info("No events found.");
            return { scanned: 0, updated: 0, details: [] };
        }

        logger.info(`Found ${eventsSnapshot.size} events to process.`);

        const batchSize = 500;
        let batch = db.batch();
        let opCounter = 0;
        let updatedCount = 0;
        const details: string[] = [];

        // Process in parallel chunks to speed up
        const processEvent = async (eventDoc: admin.firestore.QueryDocumentSnapshot) => {
            const eventData = eventDoc.data();
            const eventId = eventDoc.id;
            const currentCount = eventData.registrationsCount || 0;
            const unitType = eventData.unitType || "Players";

            let realCount = 0;

            if (unitType === "Teams") {
                const teamsQuery = await db.collection("teams")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "CONFIRMED")
                    .count()
                    .get();
                realCount = teamsQuery.data().count;
            } else {
                const regsQuery = await db.collection("registrations")
                    .where("eventId", "==", eventId)
                    .where("status", "==", "CONFIRMED")
                    .count()
                    .get();
                realCount = regsQuery.data().count;
            }

            return {
                ref: eventDoc.ref,
                eventId,
                currentCount,
                realCount
            };
        };

        const results = await Promise.all(eventsSnapshot.docs.map(doc => processEvent(doc)));

        for (const res of results) {
            if (res.realCount !== res.currentCount) {
                batch.update(res.ref, { registrationsCount: res.realCount });
                opCounter++;
                updatedCount++;
                details.push(`Event ${res.eventId}: Updated logic from ${res.currentCount} to ${res.realCount}`);

                if (opCounter >= batchSize) {
                    await batch.commit();
                    batch = db.batch();
                    opCounter = 0;
                }
            }
        }

        if (opCounter > 0) {
            await batch.commit();
        }

        logger.info(`Recalculation complete. Scanned ${eventsSnapshot.size}, Updated ${updatedCount}.`);

        return {
            scanned: eventsSnapshot.size,
            updated: updatedCount,
            details
        };

    } catch (error) {
        logger.error("Error in recalculateEventCounts:", error);
        throw new HttpsError("internal", "Failed to recalculate event counts", error);
    }
});
