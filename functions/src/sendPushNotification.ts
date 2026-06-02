import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

/**
 * Lazily initializes the Firebase Admin SDK. Safe to call multiple times.
 */
function ensureAdminInitialized() {
    if (admin.apps.length === 0) {
        admin.initializeApp();
    }
}

/**
 * Cloud Function triggered when a new notification document is created.
 * Sends an FCM push notification to all registered device tokens for the target user.
 */
export const sendPushNotification = onDocumentCreated(
    "notifications/{notificationId}",
    async (event) => {
        ensureAdminInitialized();

        const snapshot = event.data;
        if (!snapshot) {
            logger.warn("No data associated with the event");
            return;
        }

        const notificationData = snapshot.data();
        const userId = notificationData.userId;

        if (!userId) {
            logger.warn("Notification document missing userId field", {
                notificationId: event.params.notificationId,
            });
            return;
        }

        // Fetch the user's document to get their FCM tokens
        const userDoc = await admin
            .firestore()
            .collection("users")
            .doc(userId)
            .get();

        if (!userDoc.exists) {
            logger.warn(`User document not found for userId: ${userId}`);
            return;
        }

        const userData = userDoc.data();
        const fcmTokens: string[] = userData?.fcmTokens || [];

        if (fcmTokens.length === 0) {
            logger.info(
                `No FCM tokens found for user ${userId}. Skipping push.`
            );
            return;
        }

        // Build the notification payload
        const title =
            notificationData.title || getDefaultTitle(notificationData.type);
        const body =
            notificationData.message ||
            notificationData.body ||
            "You have a new notification.";

        const messages: admin.messaging.TokenMessage[] = fcmTokens.map(
            (token) => ({
                token,
                notification: {
                    title,
                    body,
                },
                webpush: {
                    fcmOptions: {
                        link: notificationData.link || "/dashboard",
                    },
                },
            })
        );

        logger.info(
            `Sending FCM to ${fcmTokens.length} token(s) for user ${userId}`
        );

        try {
            const response = await admin.messaging().sendEach(messages);

            logger.info(
                `FCM send results: ${response.successCount} success, ${response.failureCount} failure`
            );

            // Clean up invalid tokens
            if (response.failureCount > 0) {
                const tokensToRemove: string[] = [];

                response.responses.forEach((resp: { success: boolean; messageId?: string; error?: { code: string; message: string } }, idx: number) => {
                    if (resp.error) {
                        const errorCode = resp.error.code;
                        // These error codes indicate the token is no longer valid
                        if (
                            errorCode ===
                                "messaging/invalid-registration-token" ||
                            errorCode ===
                                "messaging/registration-token-not-registered"
                        ) {
                            logger.info(
                                `Removing invalid token for user ${userId}: ${errorCode}`
                            );
                            tokensToRemove.push(fcmTokens[idx]);
                        } else {
                            logger.error(
                                `Error sending to token index ${idx}:`,
                                resp.error
                            );
                        }
                    }
                });

                if (tokensToRemove.length > 0) {
                    await admin
                        .firestore()
                        .collection("users")
                        .doc(userId)
                        .update({
                            fcmTokens:
                                admin.firestore.FieldValue.arrayRemove(
                                    ...tokensToRemove
                                ),
                        });
                    logger.info(
                        `Removed ${tokensToRemove.length} invalid token(s) for user ${userId}`
                    );
                }
            }
        } catch (error) {
            logger.error(
                `Failed to send push notification for user ${userId}:`,
                error
            );
        }
    }
);

/**
 * Returns a human-readable notification title based on the notification type.
 */
function getDefaultTitle(type?: string): string {
    switch (type) {
        case "event_invite":
            return "Event Invitation";
        case "team_invite":
            return "Team Invitation";
        case "event_update":
            return "Event Updated";
        case "event_reminder":
            return "Event Reminder";
        case "team_update":
            return "Team Update";
        case "registration_confirmed":
            return "Registration Confirmed";
        case "registration_cancelled":
            return "Registration Cancelled";
        default:
            return "EveryWherePadel";
    }
}
