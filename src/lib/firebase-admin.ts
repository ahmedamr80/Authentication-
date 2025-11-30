import "server-only";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";

export function getAdminAuth() {
    if (!admin.apps.length) {
        const serviceAccountPath = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH;

        if (!serviceAccountPath) {
            throw new Error("FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH is not defined");
        }

        try {
            // Resolve path relative to CWD (root of project)
            const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
            const fileContent = fs.readFileSync(resolvedPath, "utf8");
            const serviceAccount = JSON.parse(fileContent);

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        } catch (error) {
            console.error("Failed to initialize Firebase Admin:", error);
            throw new Error("Failed to initialize Firebase Admin");
        }
    }

    return admin.auth();
}
