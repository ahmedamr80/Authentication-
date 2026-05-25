import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

export const sendPushNotificationOnNewDoc = onDocumentCreated("notifications/{notificationId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        logger.error("No data associated with the event");
        return;
    }

    const notificationData = snapshot.data();
    const userId = notificationData.userId;
    const title = notificationData.title || "New Notification";
    const body = notificationData.message || "You have a new message.";

    if (!userId) {
        logger.error("Notification document missing userId");
        return;
    }

    try {
        // Get the user document to retrieve FCM tokens
        const userDoc = await admin.firestore().collection("users").doc(userId).get();
        if (!userDoc.exists) {
            logger.warn(`User document ${userId} not found`);
            return;
        }

        const userData = userDoc.data();
        const fcmTokens = userData?.fcmTokens as string[] | undefined;

        if (!fcmTokens || fcmTokens.length === 0) {
            logger.info(`No FCM tokens found for user ${userId}`);
            return;
        }

        const message = {
            notification: {
                title: title,
                body: body,
            },
            tokens: fcmTokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        logger.info(`Successfully sent ${response.successCount} messages; Failed ${response.failureCount} messages.`);

        // Optional: Clean up invalid tokens
        if (response.failureCount > 0) {
             const failedTokens: string[] = [];
             response.responses.forEach((resp, idx) => {
                 if (!resp.success) {
                     // Check if token is invalid or expired
                     if (resp.error?.code === 'messaging/invalid-registration-token' ||
                         resp.error?.code === 'messaging/registration-token-not-registered') {
                         failedTokens.push(fcmTokens[idx]);
                     }
                 }
             });

             if (failedTokens.length > 0) {
                 await admin.firestore().collection("users").doc(userId).update({
                     fcmTokens: admin.firestore.FieldValue.arrayRemove(...failedTokens)
                 });
                 logger.info(`Cleaned up ${failedTokens.length} invalid tokens for user ${userId}`);
             }
        }

    } catch (error) {
        logger.error(`Error sending push notification for user ${userId}`, error);
    }
});