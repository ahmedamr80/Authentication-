import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const nextPageToken = searchParams.get("nextPageToken") || undefined;
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    // Security Check
    const authHeader = request.headers.get("Authorization");
    const apiKey = process.env.ADMIN_API_KEY;

    if (!apiKey || !authHeader || authHeader !== `Bearer ${apiKey}`) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        const auth = getAdminAuth();
        const listUsersResult = await auth.listUsers(limit, nextPageToken);

        const users = listUsersResult.users.map((user) => ({
            uid: user.uid,
            email: user.email,
            fullName: user.displayName,
            providerData: user.providerData.map((p) => ({
                providerId: p.providerId,
                uid: p.uid,
                fullName: p.displayName,
                email: p.email,
            })),
            metadata: {
                creationTime: user.metadata.creationTime,
                lastSignInTime: user.metadata.lastSignInTime,
            },
        }));

        return NextResponse.json({
            users,
            pageToken: listUsersResult.pageToken,
        });
    } catch (error: any) {
        console.error("Error listing users:", error);
        return NextResponse.json(
            { error: "Internal Server Error", details: error.message },
            { status: 500 }
        );
    }
}
