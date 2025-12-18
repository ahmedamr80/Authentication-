/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

export const onUserUpdate = onDocumentWritten("users/{userId}", async (event) => {
    const userId = event.params.userId;
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    // If document is deleted, we might want to remove claims or do nothing.
    // For now, let's focus on updates/creation.
    if (!afterData) {
        logger.info(`User document ${userId} deleted. Skipping claim update.`);
        return;
    }

    const isAdminBefore = beforeData?.isAdmin === true;
    const isAdminAfter = afterData?.isAdmin === true;

    // Also check for 'role' field as fallback or primary, depending on your schema.
    // The AuthContext checks: userDocSnap.data()?.role === "admin"
    const roleBefore = beforeData?.role;
    const roleAfter = afterData?.role;
    const isRoleAdminBefore = roleBefore === "admin";
    const isRoleAdminAfter = roleAfter === "admin";

    const shouldBeAdmin = isAdminAfter || isRoleAdminAfter;
    const wasAdmin = isAdminBefore || isRoleAdminBefore;

    if (shouldBeAdmin !== wasAdmin) {
        logger.info(`Updating admin claim for user ${userId} to ${shouldBeAdmin}`);
        try {
            // Set custom user claims
            // clear existing claims and set new ones or merge? 
            // setCustomUserClaims REPLACES existing claims.
            // So we should strictly set what we know. 
            // Ideally we'd fetch existing claims, but for admin boolean, 
            // we usually just want to toggle the 'admin' key.
            // However, setCustomUserClaims overwrites ALL claims. 
            // If there are other claims, we must preserve them.
            // But we can't easily read other claims from here without using getIdToken which requires a user sign-in or similar.
            // Actually, admin.auth().getUser(userId).customClaims gives us current claims.

            const userRecord = await admin.auth().getUser(userId);
            const currentClaims = userRecord.customClaims || {};

            if (shouldBeAdmin) {
                await admin.auth().setCustomUserClaims(userId, { ...currentClaims, admin: true });
            } else {
                // Remove admin claim
                const newClaims = { ...currentClaims };
                delete newClaims.admin;
                await admin.auth().setCustomUserClaims(userId, newClaims);
            }
            logger.info(`Successfully updated admin claim for ${userId}`);
        } catch (error) {
            logger.error(`Error updating custom claims for ${userId}`, error);
        }
    } else {
        logger.debug(`No admin status change for ${userId}. Data:`, afterData);
    }
});
