import { NextResponse } from "next/server";
import { validateState, parseAndValidateIDTokenClaims } from "@/lib/auth/pkce-oidc";
import { processSocialLoginUser } from "@/lib/auth/apple-auth";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { provider, state, storedState, idToken, userPayload } = body || {};

        if (!provider || !["apple", "google"].includes(provider)) {
            return NextResponse.json({ success: false, error: "Unsupported or missing OAuth provider." }, { status: 400 });
        }

        // 1. PKCE / State CSRF Validation
        if (storedState && !validateState(state, storedState)) {
            return NextResponse.json(
                { success: false, error: "CSRF state mismatch or missing state parameter." },
                { status: 400 }
            );
        }

        let sub = "";
        let email = "";
        const fullName = userPayload?.fullName || "";
        const photoUrl = userPayload?.photoUrl || "";

        if (idToken) {
            try {
                // Determine expected audience based on provider
                const expectedAudience = provider === "apple"
                    ? (process.env.APPLE_SERVICE_ID || "com.ewpuae.app")
                    : (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "");

                const claims = parseAndValidateIDTokenClaims(idToken, expectedAudience);
                sub = claims.sub;
                if (claims.email) {
                    email = claims.email;
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : "ID token validation failed";
                console.error(`OIDC ID token validation failed for ${provider}:`, msg);
                // Return clear security error for tampered or invalid ID token
                return NextResponse.json({ success: false, error: `Invalid ID token: ${msg}` }, { status: 400 });
            }
        }

        // Fallback to user payload if sub / email provided in verified client payload
        if (!sub && userPayload?.sub) {
            sub = userPayload.sub;
        }
        if (!email && userPayload?.email) {
            email = userPayload.email;
        }

        if (!sub || !email) {
            return NextResponse.json(
                { success: false, error: "Missing durable sub claim or email address in OAuth payload." },
                { status: 400 }
            );
        }

        // 2. Process Social Login (sub claim mapping + name preservation + private relay support)
        const result = await processSocialLoginUser({
            provider,
            sub,
            email,
            fullName,
            photoUrl,
        });

        return NextResponse.json({
            success: true,
            uid: result.uid,
            isNewUser: result.isNewUser,
            message: "Social authentication completed successfully.",
        });
    } catch (error) {
        console.error("Error in OAuth callback API route:", error);
        return NextResponse.json(
            { success: false, error: "An unexpected error occurred during social sign-in callback." },
            { status: 500 }
        );
    }
}
