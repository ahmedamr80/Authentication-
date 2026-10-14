import admin from "firebase-admin";
import path from "path";
import fs from "fs";

let adminApp: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
    if (adminApp) {
        return adminApp;
    }
    if (admin.apps.length > 0 && admin.apps[0]) {
        adminApp = admin.apps[0];
        return adminApp;
    }

    const projectId =
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        "db-padel-reg";

    const serviceAccountPath = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH;
    const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;

    if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        adminApp = admin.initializeApp({
            projectId,
        });
    } else if (serviceAccountJson) {
        try {
            const serviceAccount = JSON.parse(serviceAccountJson);
            adminApp = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id || projectId,
            });
        } catch (error) {
            console.error("[firebase-admin] Failed to initialize from serviceAccountJson:", error);
            adminApp = admin.initializeApp({ projectId });
        }
    } else if (serviceAccountPath && fs.existsSync(path.resolve(process.cwd(), serviceAccountPath))) {
        try {
            const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
            const fileContent = fs.readFileSync(resolvedPath, "utf8");
            const serviceAccount = JSON.parse(fileContent);
            adminApp = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id || projectId,
            });
        } catch (error) {
            console.error("[firebase-admin] Failed to load service account file:", error);
            adminApp = admin.initializeApp({ projectId });
        }
    } else if (process.env.FIREBASE_CONFIG) {
        // Cloud Run / Firebase Functions standard environment
        try {
            adminApp = admin.initializeApp();
        } catch (fbConfigError) {
            console.error("[firebase-admin] Error initializing with FIREBASE_CONFIG:", fbConfigError);
            adminApp = admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                projectId,
            });
        }
    } else {
        try {
            adminApp = admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                projectId,
            });
        } catch (appDefaultError) {
            console.warn("[firebase-admin] applicationDefault failed, falling back to projectId:", appDefaultError);
            adminApp = admin.initializeApp({ projectId });
        }
    }

    return adminApp;
}

export function getAdminAuth() {
    const app = getAdminApp();
    return admin.auth(app);
}

export function getAdminFirestore() {
    const app = getAdminApp();
    return admin.firestore(app);
}

export function getAdminStorage() {
    const app = getAdminApp();
    return admin.storage(app);
}
