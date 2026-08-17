import { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const EMAIL_VERIFICATION_ON: string = "on";

export interface EligibilityResult {
    eligible: boolean;
    reason?: "UNAUTHENTICATED" | "EMAIL_NOT_VERIFIED" | "PHONE_MISSING";
    message: string;
    isEmailVerified: boolean;
    hasPhone: boolean;
    phone?: string;
}

export async function checkPlayerEligibility(
    user: User | null,
    cachedProfile?: { phone?: string; [key: string]: any } | null
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

    // Check phone number in profile
    let phone = cachedProfile?.phone;
    if (phone === undefined || phone === null) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                phone = userDoc.data()?.phone;
            }
        } catch (err) {
            console.warn("Could not check user phone in Firestore:", err);
        }
    }

    const hasPhone = typeof phone === "string" && phone.trim().length >= 8;

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
