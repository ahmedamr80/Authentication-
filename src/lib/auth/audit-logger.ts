import { getAdminFirestore } from "@/lib/firebase-admin";

export interface AuditLogEntry {
    event: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOCKOUT_TRIGGERED" | "PASSWORD_RESET_REQUESTED" | "CAPTCHA_REQUIRED" | "ACCOUNT_DELETED";
    ip: string;
    email: string;
    timestamp: string; // ISO 8601 string
    userAgent?: string;
    details?: Record<string, unknown>;
}

export const inMemoryAuditLogs: AuditLogEntry[] = [];

/**
 * Logs authentication security events for anomaly auditing.
 * CRITICAL SECURITY RULE: Never includes raw passwords, full secret tokens, or sensitive credentials.
 */
export async function logAuthSecurityEvent(
    event: AuditLogEntry["event"],
    ip: string,
    email: string,
    userAgent?: string,
    details?: Record<string, unknown>
): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
        event,
        ip,
        email: email.trim().toLowerCase(),
        timestamp: new Date().toISOString(),
        userAgent: userAgent || "unknown",
        details: details || {},
    };

    // Store in in-memory list for quick queryable testing
    inMemoryAuditLogs.push(entry);
    if (inMemoryAuditLogs.length > 500) {
        inMemoryAuditLogs.shift();
    }

    console.log(`[AUTH-AUDIT-LOG] [${entry.event}] IP: ${entry.ip} | Email: ${entry.email} | Time: ${entry.timestamp}`);

    try {
        const adminDb = getAdminFirestore();
        await adminDb.collection("auth_audit_logs").add(entry);
    } catch (err) {
        console.error("Failed to write audit log entry to Firestore:", err);
    }

    return entry;
}

/**
 * Returns recent audit log entries for testing & verification.
 */
export function getRecentAuditLogs(email?: string): AuditLogEntry[] {
    if (!email) return inMemoryAuditLogs;
    const normalized = email.trim().toLowerCase();
    return inMemoryAuditLogs.filter((log) => log.email === normalized);
}
