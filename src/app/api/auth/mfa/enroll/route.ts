import { NextResponse } from "next/server";
import { generateTOTPSecret, generateBackupCodes, verifyTOTPCode } from "@/lib/auth/mfa";
import { getAdminFirestore } from "@/lib/firebase-admin";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { uid, action, code } = body || {};

        if (!uid || typeof uid !== "string") {
            return NextResponse.json({ success: false, error: "User ID (uid) is required." }, { status: 400 });
        }

        const adminDb = getAdminFirestore();
        const userDocRef = adminDb.collection("users").doc(uid);
        const userSnap = await userDocRef.get();

        if (!userSnap.exists) {
            return NextResponse.json({ success: false, error: "User not found." }, { status: 400 });
        }

        const userData = userSnap.data();
        const email = userData?.email || "user@app.com";

        // ACTION: Confirm Enrollment (Verify initial 6-digit code to activate MFA)
        if (action === "confirm") {
            if (!code || typeof code !== "string") {
                return NextResponse.json({ success: false, error: "Verification code is required to activate MFA." }, { status: 400 });
            }

            const secret = userData?.mfa_secret;
            if (!secret) {
                return NextResponse.json({ success: false, error: "MFA setup has not been initialized." }, { status: 400 });
            }

            const isValid = verifyTOTPCode(secret, code.trim());
            if (!isValid) {
                return NextResponse.json({ success: false, error: "Invalid authenticator code. Verification failed." }, { status: 400 });
            }

            await userDocRef.update({
                mfa_enabled: true,
                mfa_type: "totp",
                mfa_enrolled_at: new Date().toISOString(),
            });

            return NextResponse.json({
                success: true,
                message: "MFA has been successfully enabled on your account.",
            });
        }

        // ACTION: Initialize Enrollment (Generate TOTP secret & 8 single-use backup codes)
        const secret = generateTOTPSecret();
        const { rawCodes, hashedRecords } = generateBackupCodes(8);
        const otpauthUrl = `otpauth://totp/EveryWherePadel:${encodeURIComponent(email)}?secret=${secret}&issuer=EveryWherePadel`;

        await userDocRef.update({
            mfa_secret: secret,
            mfa_enabled: false, // Inactive until user confirms initial code
            backup_codes: hashedRecords,
        });

        return NextResponse.json({
            success: true,
            secret,
            otpauthUrl,
            rawBackupCodes: rawCodes, // Returned ONCE to user during enrollment
            message: "MFA enrollment initialized. Scan QR code or enter secret into your authenticator app.",
        });
    } catch (error) {
        console.error("Error in MFA enrollment API route:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred during MFA enrollment." },
            { status: 500 }
        );
    }
}
