import { NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { hashVerificationToken } from "@/lib/auth/verification-token";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { token } = body || {};

        if (!token || typeof token !== "string") {
            return NextResponse.json({ success: false, error: "Verification token is required." }, { status: 400 });
        }

        const tokenHash = hashVerificationToken(token.trim());
        const adminDb = getAdminFirestore();
        const adminAuth = getAdminAuth();

        const tokenDocRef = adminDb.collection("verification_tokens").doc(tokenHash);
        const tokenDoc = await tokenDocRef.get();

        if (!tokenDoc.exists) {
            return NextResponse.json(
                { success: false, error: "Invalid, expired, or already used verification token." },
                { status: 400 }
            );
        }

        const tokenData = tokenDoc.data();

        // 1. Check if token was already used (Single-use enforcement)
        if (tokenData?.usedAt != null) {
            return NextResponse.json(
                { success: false, error: "This verification link has already been used." },
                { status: 400 }
            );
        }

        // 2. Check if token has expired
        if (Date.now() > tokenData?.expiresAt) {
            return NextResponse.json(
                { success: false, error: "Verification link has expired. Please request a new link." },
                { status: 400 }
            );
        }

        const uid = tokenData?.uid;
        if (!uid) {
            return NextResponse.json({ success: false, error: "Invalid token payload." }, { status: 400 });
        }

        // Mark token as used
        await tokenDocRef.update({
            usedAt: Date.now(),
        });

        // Update Firebase Auth user to emailVerified = true
        await adminAuth.updateUser(uid, {
            emailVerified: true,
        });

        // Update Firestore user record to is_email_verified = true
        await adminDb.collection("users").doc(uid).update({
            is_email_verified: true,
            emailVerified: true,
        });

        return NextResponse.json({
            success: true,
            message: "Email verified successfully! You can now sign in to your account.",
        });
    } catch (error) {
        console.error("Error in verify-email API route:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred while verifying email." },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
        return NextResponse.json({ success: false, error: "Verification token is required." }, { status: 400 });
    }

    return POST(new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    }));
}
