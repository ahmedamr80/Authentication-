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

        // 1. Authenticate caller
        try {
            const adminAuth = getAdminAuth();
            const decodedFirebaseToken = await adminAuth.verifyIdToken(token);
            callerUid = decodedFirebaseToken.uid;
            callerIsAdmin = !!decodedFirebaseToken.admin || decodedFirebaseToken.role === "admin";
        } catch {
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
        const folder = (formData.get("folder") as string) || "clubs";
        const customId = formData.get("customId") as string | null;

        if (!file || !(file instanceof Blob)) {
            return NextResponse.json(
                { success: false, error: "File is required." },
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

        // 2. Check Admin role in Firestore if not present on token
        if (!callerIsAdmin) {
            const callerDoc = await adminDb.collection("users").doc(callerUid).get();
            if (callerDoc.exists) {
                const callerData = callerDoc.data();
                if (callerData?.role === "admin" || callerData?.isAdmin === true) {
                    callerIsAdmin = true;
                }
            }
        }

        // For administrative assets (clubs, events, media), require admin role
        if (["clubs", "club-pictures", "events", "media", "media_library"].includes(folder) && !callerIsAdmin) {
            return NextResponse.json(
                { success: false, error: "Forbidden: Admin privileges required." },
                { status: 403 }
            );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        let downloadUrl = "";
        const cleanFileName = file.name ? file.name.replace(/[^a-zA-Z0-9.-]/g, "_") : "image.jpg";
        const storagePath = `${folder}/${customId || `${Date.now()}_${cleanFileName}`}`;

        // 3. Attempt Admin Storage Upload
        try {
            const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "db-padel-reg.firebasestorage.app";
            const bucket = getAdminStorage().bucket(bucketName);
            const gcsFile = bucket.file(storagePath);

            await gcsFile.save(buffer, {
                metadata: {
                    contentType: file.type || "image/jpeg",
                },
                resumable: false,
            });

            await gcsFile.makePublic().catch(() => {});
            downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;
        } catch (storageErr) {
            console.warn("Storage upload fallback to Data URI for upload route:", storageErr);
            const base64 = buffer.toString("base64");
            downloadUrl = `data:${file.type || "image/jpeg"};base64,${base64}`;
        }

        return NextResponse.json({
            success: true,
            url: downloadUrl,
            storagePath,
            message: "File uploaded successfully.",
        });
    } catch (error) {
        console.error("Error in upload route:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
