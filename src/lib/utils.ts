import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
/**
 * Fetches a user's display name from Firestore, with fallback options.
 * @param uid - The Firestore User ID
 * @param fallbackName - (Optional) A name to use if Firestore fails (e.g. Auth name)
 */
export const fetchPlayerName = async (uid: string, fallbackName?: string | null) => {
    if (!uid) return fallbackName || "Unknown Player";

    try {
        const userRef = doc(db, "users", uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            // The Priority Logic
            // 1. fullName (CamelCase - Standard)
            // 2. fullname (lowercase - legacy/typo)
            // 3. displayName (Auth standard)
            // 4. firstName + lastName (if both exist)
            // 5. fallbackName (Auth/Caller provided)
            // 6. "Unknown Player"

            if (data.fullName) return data.fullName;
            if (data.fullname) return data.fullname;
            if (data.displayName) return data.displayName;
            if (data.firstName && data.lastName) return `${data.firstName} ${data.lastName}`;

            return fallbackName || "Unknown Player";
        }
    } catch (error) {
        console.error("Error fetching player name:", error);
    }

    return fallbackName || "Unknown Player";
};

/**
 * Safely resolves a player's profile photo URL across multiple Firestore schemas,
 * registration snapshots, and auth fallbacks. Filters out invalid values like 'null',
 * 'undefined', or empty strings.
 */
export function resolvePlayerPhoto(
    profile?: Record<string, any> | null,
    registration?: Record<string, any> | null,
    authFallback?: Record<string, any> | null
): string | undefined {
    const candidates = [
        profile?.photoUrl,
        profile?.photoURL,
        profile?.photo,
        profile?.avatarUrl,
        profile?.avatarURL,
        profile?.avatar,
        profile?.profileImage,
        profile?.picture,
        profile?.image,
        profile?.imageUrl,
        registration?.playerPhotoURL,
        registration?.playerPhotoUrl,
        registration?.player1PhotoURL,
        registration?.player1PhotoUrl,
        registration?.photoURL,
        registration?.photoUrl,
        registration?.avatarUrl,
        registration?.avatar,
        registration?.image,
        registration?.photo,
        authFallback?.photoURL,
        authFallback?.photoUrl,
    ];

    for (const cand of candidates) {
        if (typeof cand === "string") {
            const trimmed = cand.trim();
            if (
                trimmed &&
                trimmed !== "null" &&
                trimmed !== "undefined" &&
                trimmed !== "[object Object]" &&
                (trimmed.startsWith("http://") ||
                 trimmed.startsWith("https://") ||
                 trimmed.startsWith("data:image/") ||
                 trimmed.startsWith("/"))
            ) {
                return trimmed;
            }
        }
    }

    return undefined;
}