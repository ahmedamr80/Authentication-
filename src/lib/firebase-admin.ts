import admin from "firebase-admin";
import path from "path";
import fs from "fs";

export function getAdminApp() {
    if (!admin.apps.length) {
        const serviceAccountPath = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH;
        const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

        if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
            admin.initializeApp({
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-project",
            });
        } else if (serviceAccountPath) {
            try {
                const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
                if (fs.existsSync(resolvedPath)) {
                    const fileContent = fs.readFileSync(resolvedPath, "utf8");
                    const serviceAccount = JSON.parse(fileContent);
                    admin.initializeApp({
                        credential: admin.credential.cert(serviceAccount),
                    });
                } else {
                    admin.initializeApp({
                        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "firebase-auth-app",
                    });
                }
            } catch (error) {
                console.error("Failed to initialize Firebase Admin from serviceAccountPath:", error);
                admin.initializeApp();
            }
        } else if (serviceAccountJson) {
            try {
                const serviceAccount = JSON.parse(serviceAccountJson);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            } catch (error) {
                console.error("Failed to initialize Firebase Admin from serviceAccountJson:", error);
                admin.initializeApp();
            }
        } else {
            admin.initializeApp({
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "firebase-auth-app",
            });
        }
    }
    return admin.app();
}

export function getAdminAuth() {
    getAdminApp();
    return admin.auth();
}

export function getAdminFirestore() {
    getAdminApp();
    return admin.firestore();
}

export function getAdminStorage() {
    getAdminApp();
    return admin.storage();
}
