import { NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore, getAdminStorage } from "@/lib/firebase-admin";
import { verifyAccessToken } from "@/lib/auth/tokens";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { success: false, error: "Missing or invalid authorization header." },
                { status: 401 }
            );
        }

        const token = authHeader.substring(7).trim();
        let callerUid: string | null = null;
        let callerIsAdmin = false;

        // 1. Try Firebase Auth ID token
        try {
            const adminAuth = getAdminAuth();
            const decodedFirebaseToken = await adminAuth.verifyIdToken(token);
            callerUid = decodedFirebaseToken.uid;
            callerIsAdmin = !!decodedFirebaseToken.admin || decodedFirebaseToken.role === "admin";
        } catch {
            // 2. Fallback to custom JWT access token
            try {
                const decodedCustomToken = await verifyAccessToken(token);
                callerUid = decodedCustomToken.sub;
                callerIsAdmin = !!decodedCustomToken.isAdmin || decodedCustomToken.role === "admin";
            } catch {
                return NextResponse.json(
                    { success: false, error: "Unauthorized: Invalid token." },
                    { status: 401 }
                );
            }
        }

        if (!callerUid) {
            return NextResponse.json(
                { success: false, error: "Unauthorized." },
                { status: 401 }
            );
        }

        // Parse FormData
        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const targetUid = formData.get("targetUid") as string | null;

        if (!targetUid || typeof targetUid !== "string") {
            return NextResponse.json(
                { success: false, error: "targetUid is required." },
                { status: 400 }
            );
        }

        if (!file || !(file instanceof Blob)) {
            return NextResponse.json(
                { success: false, error: "Image file is required." },
                { status: 400 }
            );
        }

        if (!file.type.startsWith("image/")) {
            return NextResponse.json(
                { success: false, error: "Only image files are allowed." },
                { status: 400 }
            );
        }

        if (file.size > 5 * 1024 * 1024) {
            return NextResponse.json(
                { success: false, error: "File size exceeds 5MB limit." },
                { status: 400 }
            );
        }

        const adminDb = getAdminFirestore();

        // Check Admin permissions if caller is not the owner
        if (callerUid !== targetUid && !callerIsAdmin) {
            const callerDoc = await adminDb.collection("users").doc(callerUid).get();
            if (callerDoc.exists) {
                const callerData = callerDoc.data();
                if (callerData?.role === "admin" || callerData?.isAdmin === true) {
                    callerIsAdmin = true;
                }
            }

            if (!callerIsAdmin) {
                return NextResponse.json(
                    { success: false, error: "Forbidden: You do not have permission to update another user's image." },
                    { status: 403 }
                );
            }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        let photoUrl = "";

        // Attempt upload to Firebase Storage
        try {
            const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "db-padel-reg.firebasestorage.app";
            const bucket = getAdminStorage().bucket(bucketName);
            const fileName = `profile-pictures/${targetUid}`;
            const gcsFile = bucket.file(fileName);

            await gcsFile.save(buffer, {
                metadata: {
                    contentType: file.type || "image/jpeg",
                },
                resumable: false,
            });

            await gcsFile.makePublic().catch(() => {});
            photoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
        } catch (storageErr) {
            console.warn("Storage upload fallback to Data URI:", storageErr);
            const base64 = buffer.toString("base64");
            photoUrl = `data:${file.type || "image/jpeg"};base64,${base64}`;
        }

        // Update Firestore document
        await adminDb.collection("users").doc(targetUid).set(
            {
                photoUrl: photoUrl,
                updatedAt: new Date(),
            },
            { merge: true }
        );

        return NextResponse.json({
            success: true,
            photoUrl,
            targetUid,
            message: "Photo updated successfully.",
        });
    } catch (error) {
        console.error("Error in upload-photo route:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
