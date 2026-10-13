import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const EMAIL_VERIFICATION_ON: string = "on";

export interface EligibilityResult {
    eligible: boolean;
    reason?: "UNAUTHENTICATED" | "EMAIL_NOT_VERIFIED" | "PHONE_MISSING" | "REDFLAGGED";
    message: string;
    isEmailVerified: boolean;
    hasPhone: boolean;
    phone?: string;
    isRedflagged?: boolean;
    redflagReason?: string;
}

export async function checkPlayerEligibility(
    user: User | null,
    cachedProfile?: { phone?: string; redflagged?: boolean; redflagReason?: string | null; [key: string]: any } | null
): Promise<EligibilityResult> {
    if (!user) {
        return {
            eligible: false,
            reason: "UNAUTHENTICATED",
            message: "Please sign in to register for events.",
            isEmailVerified: false,
            hasPhone: false,
        };
    }

    // Check email verification
    try {
        await user.reload();
    } catch {
        // Ignore reload error
    }
    const isEmailVerified = EMAIL_VERIFICATION_ON === "off" || !!user.emailVerified;

    // Check user profile data (phone and redflagged)
    let phone = cachedProfile?.phone;
    let isRedflagged = cachedProfile?.redflagged === true;
    let redflagReason = cachedProfile?.redflagReason;

    if (
        phone === undefined ||
        phone === null ||
        cachedProfile === undefined ||
        cachedProfile === null ||
        cachedProfile?.redflagged === undefined
    ) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                if (userData?.redflagged) {
                    isRedflagged = true;
                    redflagReason = userData.redflagReason;
                }
                if (phone === undefined || phone === null) {
                    phone = userData?.phone;
                }
            }
        } catch (err) {
            console.warn("Could not check user in Firestore:", err);
        }
    }

    const hasPhone = typeof phone === "string" && phone.trim().length >= 8;

    // 1. Red-flagged players CANNOT register unless approved by admins
    if (isRedflagged) {
        return {
            eligible: false,
            reason: "REDFLAGGED",
            message: "Your account is red-flagged. You cannot register for events until approved by an administrator.",
            isEmailVerified,
            hasPhone,
            phone: phone || "",
            isRedflagged: true,
            redflagReason: redflagReason || "Late withdrawal",
        };
    }

    if (!isEmailVerified) {
        return {
            eligible: false,
            reason: "EMAIL_NOT_VERIFIED",
            message: "Please verify your email address to register for events.",
            isEmailVerified,
            hasPhone,
            phone: phone || "",
        };
    }

    if (!hasPhone) {
        return {
            eligible: false,
            reason: "PHONE_MISSING",
            message: "Please add your phone number to your profile before registering for events.",
            isEmailVerified,
            hasPhone,
            phone: phone || "",
        };
    }

    return {
        eligible: true,
        message: "Eligible to register.",
        isEmailVerified: true,
        hasPhone: true,
        phone: phone || "",
    };
}
