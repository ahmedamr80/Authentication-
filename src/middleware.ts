import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
    const { method, headers, nextUrl } = request;

    // 1. Strict CSRF & Origin Validation for State-Changing API Requests
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method) && nextUrl.pathname.startsWith("/api/")) {
        const origin = headers.get("origin");
        const host = headers.get("host");

        if (origin) {
            try {
                const originUrl = new URL(origin);
                const expectedHost = host?.split(":")[0];
                const originHost = originUrl.hostname;

                // Enforce origin matching target host (ignoring port in dev)
                if (expectedHost && originHost !== expectedHost && originHost !== "localhost" && originHost !== "127.0.0.1") {
                    console.warn(`[CSRF-SECURITY-ALERT] Blocked cross-origin mutation request! Origin: ${origin} | Host: ${host}`);
                    return NextResponse.json(
                        { success: false, error: "CSRF verification failed: Cross-origin mutation request rejected." },
                        { status: 403 }
                    );
                }
            } catch {
                return NextResponse.json(
                    { success: false, error: "CSRF verification failed: Invalid origin header." },
                    { status: 403 }
                );
            }
        }
    }

    // 2. Append Security Headers to Response
    const response = NextResponse.next();

    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    response.headers.set(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://*.firebaseapp.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            "img-src 'self' data: blob: https://*.googleapis.com https://*.googleusercontent.com https://firebasestorage.googleapis.com https://lh3.googleusercontent.com https://*",
            "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com wss://*.firebaseio.com wss://*.firestore.googleapis.com https://*.firebaseapp.com https://appleid.apple.com ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
            "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://appleid.apple.com",
            "object-src 'none'",
            "base-uri 'self'",
        ].join("; ")
    );

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
