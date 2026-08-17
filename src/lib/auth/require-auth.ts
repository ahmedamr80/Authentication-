import { NextResponse } from "next/server";
import { verifyAccessToken, AccessTokenPayload } from "@/lib/auth/tokens";
import { hasRole, hasPermission, isResourceOwner, Role } from "@/lib/auth/rbac-abac";

export interface AuthResult {
    authenticated: boolean;
    user?: AccessTokenPayload;
    error?: string;
}

/**
 * Extracts and validates the `Authorization: Bearer <token>` header from incoming API requests.
 */
export async function authenticateApiRequest(request: Request): Promise<AuthResult> {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return {
            authenticated: false,
            error: "Authorization header missing or malformed. Expected 'Bearer <token>'.",
        };
    }

    const token = authHeader.substring(7).trim();

    try {
        const payload = await verifyAccessToken(token);
        return {
            authenticated: true,
            user: payload,
        };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Token validation failed";
        return {
            authenticated: false,
            error: msg,
        };
    }
}

/**
 * Higher-order guard requiring valid authentication.
 * Rejects unauthenticated requests with HTTP 401.
 */
export function withApiAuth(
    handler: (request: Request, user: AccessTokenPayload) => Promise<NextResponse>
) {
    return async (request: Request) => {
        const auth = await authenticateApiRequest(request);

        if (!auth.authenticated || !auth.user) {
            return NextResponse.json(
                { success: false, error: auth.error || "Unauthorized access." },
                { status: 401 }
            );
        }

        return handler(request, auth.user);
    };
}

/**
 * Higher-order guard requiring specific RBAC role.
 * Rejects unauthorized role access with HTTP 403 Forbidden.
 */
export function withRole(
    requiredRole: Role,
    handler: (request: Request, user: AccessTokenPayload) => Promise<NextResponse>
) {
    return withApiAuth(async (request, user) => {
        if (!hasRole(user.role, requiredRole)) {
            return NextResponse.json(
                { success: false, error: `Forbidden: Required role '${requiredRole}' missing.` },
                { status: 403 }
            );
        }
        return handler(request, user);
    });
}

/**
 * Higher-order guard requiring fine-grained RBAC permission.
 * Rejects unauthorized permission access with HTTP 403 Forbidden.
 */
export function withPermission(
    requiredPermission: string,
    handler: (request: Request, user: AccessTokenPayload) => Promise<NextResponse>
) {
    return withApiAuth(async (request, user) => {
        if (!hasPermission(user.role, requiredPermission)) {
            return NextResponse.json(
                { success: false, error: `Forbidden: Required permission '${requiredPermission}' missing.` },
                { status: 403 }
            );
        }
        return handler(request, user);
    });
}

/**
 * Higher-order guard enforcing ABAC ownership checks (requesterUid === targetOwnerUid or isAdmin).
 * Rejects unauthorized cross-user modifications with HTTP 403 Forbidden.
 */
export function withOwnershipOrAdmin(
    targetOwnerUid: string,
    handler: (request: Request, user: AccessTokenPayload) => Promise<NextResponse>
) {
    return withApiAuth(async (request, user) => {
        const allowed = isResourceOwner(user.sub, targetOwnerUid, user.isAdmin);

        if (!allowed) {
            return NextResponse.json(
                { success: false, error: "Forbidden: You do not have ownership permission for this resource." },
                { status: 403 }
            );
        }

        return handler(request, user);
    });
}
