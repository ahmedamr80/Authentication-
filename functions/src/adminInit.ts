import * as admin from "firebase-admin";

/**
 * Lazily initializes the Firebase Admin SDK. Safe to call multiple times.
 * Shared across all Cloud Functions to avoid duplicate initialization logic.
 */
export function ensureAdminInitialized(): void {
    if (admin.apps.length === 0) {
        admin.initializeApp();
    }
}
