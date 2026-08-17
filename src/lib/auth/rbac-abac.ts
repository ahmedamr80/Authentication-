export type Role = "admin" | "auditor" | "player" | "user";

export const ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ["*"],
    auditor: [
        "logs:read",
        "users:read",
        "events:read",
        "registrations:read",
        "teams:read",
    ],
    player: [
        "events:read",
        "events:register_self",
        "profile:read_self",
        "profile:write_self",
        "teams:manage_self",
    ],
    user: [
        "events:read",
        "events:register_self",
        "profile:read_self",
        "profile:write_self",
        "teams:manage_self",
    ],
};

/**
 * Checks if a user role matches or exceeds a required role requirement.
 */
export function hasRole(userRole: string | undefined, requiredRole: Role): boolean {
    if (!userRole) return false;
    const normalized = userRole.toLowerCase();

    if (normalized === "admin") return true; // Admin fulfills all role requirements
    if (requiredRole === "player" || requiredRole === "user") {
        return normalized === "player" || normalized === "user" || normalized === "auditor" || normalized === "admin";
    }
    if (requiredRole === "auditor") {
        return normalized === "auditor" || normalized === "admin";
    }

    return normalized === requiredRole;
}

/**
 * Checks if a user role possesses a specific permission string.
 */
export function hasPermission(userRole: string | undefined, requiredPermission: string): boolean {
    if (!userRole) return false;
    const normalized = userRole.toLowerCase();
    const permissions = ROLE_PERMISSIONS[normalized] || [];

    if (permissions.includes("*")) return true; // Full wildcard access
    if (permissions.includes(requiredPermission)) return true;

    // Check domain wildcards (e.g. "events:*" matches "events:read")
    const [domain] = requiredPermission.split(":");
    return permissions.includes(`${domain}:*`);
}

/**
 * ABAC Ownership Check: Verifies whether the requesting user owns the resource or is an Admin.
 */
export function isResourceOwner(requesterUid: string, resourceOwnerUid: string, isAdmin: boolean = false): boolean {
    if (!requesterUid || !resourceOwnerUid) return false;
    if (isAdmin) return true; // Admins override resource ownership check
    return requesterUid === resourceOwnerUid;
}
