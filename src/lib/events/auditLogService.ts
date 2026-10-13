import { Timestamp } from "firebase-admin/firestore";

export type AuditEntityType = "TEAM" | "REGISTRATION" | "EVENT";

export type AuditActionType =
    | "REGISTERED"
    | "WITHDRAWN"
    | "PROMOTED"
    | "DEMOTED"
    | "SUPERSEDED"
    | "FREE_AGENT_REVERTED"
    | "INVITED"
    | "ACCEPTED"
    | "REJECTED"
    | "CANCELLED"
    | "INELIGIBLE_FOR_PROMOTION"
    | "CAPACITY_CHANGED";

export interface AuditLogDoc {
    auditId: string;
    eventId: string;
    entityType: AuditEntityType;
    entityId: string;
    action: AuditActionType;
    actorUid: string;
    actorName?: string | null;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
    correlationId?: string | null;
    reason?: string | null;
    timestamp: any;
}

/**
 * Creates an append-only audit log entry in the root "auditLogs" collection.
 * Attaches or generates a correlationId for linking cascaded events.
 */
export function createAuditLogEntry(
    db: FirebaseFirestore.Firestore,
    batchOrTx: { set: (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => unknown },
    entry: {
        eventId: string;
        entityType: AuditEntityType;
        entityId: string;
        action: AuditActionType;
        actorUid: string;
        actorName?: string | null;
        previousState?: Record<string, unknown> | null;
        newState?: Record<string, unknown> | null;
        correlationId?: string | null;
        reason?: string | null;
        timestamp?: FirebaseFirestore.Timestamp;
    }
): { auditId: string; correlationId: string } {
    const auditRef = db.collection("auditLogs").doc();
    const correlationId =
        entry.correlationId || `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = entry.timestamp || Timestamp.now();

    const data: Record<string, unknown> = {
        auditId: auditRef.id,
        eventId: entry.eventId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actorUid: entry.actorUid,
        actorName: entry.actorName || null,
        previousState: entry.previousState || null,
        newState: entry.newState || null,
        correlationId,
        reason: entry.reason || null,
        timestamp,
    };

    batchOrTx.set(auditRef, data);
    return { auditId: auditRef.id, correlationId };
}
