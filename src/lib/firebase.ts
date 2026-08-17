import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// Check if we should use emulators (dev mode / local testing)
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true") {
    console.log("Connecting Firebase SDK to local Emulators...");
    try {
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        connectFirestoreEmulator(db, "127.0.0.1", 8080);
        connectStorageEmulator(storage, "127.0.0.1", 9199);
        connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    } catch (err) {
        console.warn("Failed to connect to emulators (they may already be connected):", err);
    }
}

// Messaging helper (async to support SSR and browsers without messaging support)
const getMessagingInstance = async () => {
    if (typeof window === "undefined") return null;
    try {
        const { getMessaging, isSupported } = await import("firebase/messaging");
        const supported = await isSupported();
        if (supported) {
            return getMessaging(app);
        }
        return null;
    } catch (err) {
        console.error("FCM is not supported in this browser:", err);
        return null;
    }
};

export { app, auth, db, storage, functions, getMessagingInstance };

