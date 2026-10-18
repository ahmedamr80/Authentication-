import { NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/lib/auth/serverAuth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { cancelIndividualEvent, adjustIndividualEventCapacity } from "@/lib/individual/individualRegistrationService";
import { cancelTeamEvent, adjustTeamEventCapacity } from "@/lib/teams/teamRegistrationService";

export async function POST(request: Request) {
    try {
        const caller = await resolveUserFromRequest(request);
        if (!caller) {
            return NextResponse.json({ success: false, error: "Unauthorized: Please sign in." }, { status: 401 });
        }

        const body = await request.json();
        const {
            eventId,
            eventName,
            locationName,
            clubId,
            dateTime,
            duration = 60,
            unitType,
            isPublic = true,
            isTeamRegistration = false,
            slotsAvailable = 8,
            pricePerPlayer = 0,
            termsAndConditions = "",
            logoUrl = "",
            coordinates = null,
            isCancelled = false,
            cancellationMessage = "",
        } = body;

        if (!eventId) {
            return NextResponse.json({ success: false, error: "eventId is required." }, { status: 400 });
        }

        const db = getAdminFirestore();
        const eventRef = db.collection("events").doc(eventId);
        const eventSnap = await eventRef.get();

        if (!eventSnap.exists) {
            return NextResponse.json({ success: false, error: "Event not found." }, { status: 404 });
        }

        const curEvent = eventSnap.data() || {};
        const isEventAdmin = curEvent.adminId === caller.uid;

        if (!caller.isAdmin && !isEventAdmin) {
            return NextResponse.json({ success: false, error: "Forbidden: Admin access required." }, { status: 403 });
        }

        const correlationId = `corr_update_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const originalUnitType: "Players" | "Teams" = curEvent.unitType || (curEvent.isTeamRegistration ? "Teams" : "Players");
        const originalSlots: number = curEvent.slotsAvailable || 8;
        const originalIsCancelled: boolean = curEvent.status === "Cancelled" || !!curEvent.cancellationMessage;
        const isUnitTypeChanged = unitType !== originalUnitType;

        // Parse date
        let parsedDate: Date;
        if (dateTime) {
            let dateStr = String(dateTime).trim();
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(dateStr)) {
                // Naive ISO string without timezone - default to UAE (+04:00)
                dateStr = `${dateStr}+04:00`;
            }
            parsedDate = new Date(dateStr);
            if (isNaN(parsedDate.getTime())) {
                return NextResponse.json({ success: false, error: "Invalid dateTime provided." }, { status: 400 });
            }
        } else if (curEvent.dateTime) {
            parsedDate = curEvent.dateTime.toDate();
        } else {
            parsedDate = new Date();
        }
        const eventTimestamp = Timestamp.fromDate(parsedDate);

        // 1. CANCELLATION CASE
        if (isCancelled && !originalIsCancelled) {
            const cancelMsg = (cancellationMessage || "").trim();
            if (originalUnitType === "Players") {
                const cancelRes = await cancelIndividualEvent(eventId, cancelMsg);
                if (!cancelRes.success) return NextResponse.json({ success: false, error: cancelRes.error }, { status: 400 });
            } else {
                const cancelRes = await cancelTeamEvent(eventId, cancelMsg);
                if (!cancelRes.success) return NextResponse.json({ success: false, error: cancelRes.error }, { status: 400 });
            }
            return NextResponse.json({ success: true, message: "Event cancelled successfully." });
        }

        const baseEventData: Record<string, unknown> = {
            eventName: (eventName || curEvent.eventName || "").trim(),
            locationName: (locationName || curEvent.locationName || "").trim(),
            clubId: clubId || null,
            dateTime: eventTimestamp,
            duration: Number(duration) || 60,
            unitType,
            isPublic: isPublic ?? true,
            isTeamRegistration: unitType === "Teams",
            slotsAvailable: Number(slotsAvailable) || originalSlots,
            pricePerPlayer: Number(pricePerPlayer) || 0,
            termsAndConditions: (termsAndConditions || "").trim(),
            logoUrl: logoUrl || "",
            coordinates: coordinates || null,
            updatedAt: FieldValue.serverTimestamp(),
            status: isCancelled ? "Cancelled" : (curEvent.status || "Upcoming"),
            cancellationMessage: isCancelled ? (cancellationMessage || "").trim() : null,
        };

        // 2. FORMAT MIGRATION CASE
        if (isUnitTypeChanged) {
            const batch = db.batch();

            if (originalUnitType === "Teams" && unitType === "Players") {
                // =========================================================================
                // CASE: TEAMS --> PLAYERS
                // Rule: Do NOT cancel the teams collection; preserve teams data as reference.
                // Rule: Make sure free agents are within the waiting list.
                // =========================================================================
                const teamsSnap = await db.collection("teams").where("eventId", "==", eventId).get();
                const confirmedTeamPlayerIds: string[] = [];
                const waitlistTeamPlayerIds: string[] = [];
                const pendingTeamPlayerIds: string[] = [];

                const playerWaitlistSeqMap = new Map<string, number>();
                const playerTeamCreatedMap = new Map<string, number>();
                const playerTeamSlotOrderMap = new Map<string, number>(); // 0 for player1, 1 for player2

                // Sort teams chronologically
                const validTeams = teamsSnap.docs
                    .map((d): Record<string, any> => ({ id: d.id, ...d.data() }))
                    .filter((t) => t.status !== "CANCELLED" && t.status !== "EXPIRED")
                    .sort((a, b) => {
                        const tA = a.createdAt ? a.createdAt.toMillis() : 0;
                        const tB = b.createdAt ? b.createdAt.toMillis() : 0;
                        return tA - tB;
                    });

                for (const t of validTeams) {
                    const tMillis = t.createdAt ? t.createdAt.toMillis() : 0;
                    if (t.status === "CONFIRMED") {
                        if (t.player1Id) confirmedTeamPlayerIds.push(t.player1Id);
                        if (t.player2Id) confirmedTeamPlayerIds.push(t.player2Id);
                    } else if (t.status === "WAITLIST") {
                        const seq = typeof t.waitlistSequence === "number" ? t.waitlistSequence : 999999;
                        if (t.player1Id) {
                            waitlistTeamPlayerIds.push(t.player1Id);
                            playerWaitlistSeqMap.set(t.player1Id, seq);
                            playerTeamCreatedMap.set(t.player1Id, tMillis);
                            playerTeamSlotOrderMap.set(t.player1Id, 0);
                        }
                        if (t.player2Id) {
                            waitlistTeamPlayerIds.push(t.player2Id);
                            playerWaitlistSeqMap.set(t.player2Id, seq);
                            playerTeamCreatedMap.set(t.player2Id, tMillis);
                            playerTeamSlotOrderMap.set(t.player2Id, 1);
                        }
                    } else if (t.status === "PENDING") {
                        if (t.player1Id) {
                            pendingTeamPlayerIds.push(t.player1Id);
                            playerTeamCreatedMap.set(t.player1Id, tMillis);
                            playerTeamSlotOrderMap.set(t.player1Id, 0);
                        }
                        if (t.player2Id) {
                            pendingTeamPlayerIds.push(t.player2Id);
                            playerTeamCreatedMap.set(t.player2Id, tMillis);
                            playerTeamSlotOrderMap.set(t.player2Id, 1);
                        }
                    }
                }

                // Query all active registrations
                const regsSnap = await db.collection("registrations").where("eventId", "==", eventId).get();
                const activeRegs = regsSnap.docs
                    .map((d): Record<string, any> => ({ id: d.id, ...d.data() }))
                    .filter((r) => r.status !== "CANCELLED");

                const newSlots = Number(slotsAvailable) || originalSlots;
                let confirmedCount = 0;
                let waitlistCount = 0;

                const confirmedPlayerSet = new Set(confirmedTeamPlayerIds);
                const waitlistTeamPlayerSet = new Set(waitlistTeamPlayerIds);
                const pendingTeamPlayerSet = new Set(pendingTeamPlayerIds);

                // Priority ranking for Players format:
                // Tier 1: Players from confirmed teams (highest priority)
                // Tier 2: Previously/currently confirmed individual players (e.g. from original Players format)
                // Tier 3: Waitlist cohorts, strictly following spec SC-CONV-01 Section 2.3:
                //         - Cohort 3A: Converted Waitlist Teams (ordered by waitlistSequence ASC)
                //         - Cohort 3B: Converted Pending Teams (proposals awaiting response, ordered by createdAt ASC)
                //         - Cohort 3C: Converted Solo Free Agents (ordered by original registeredAt ASC)
                const getRegMillis = (r: Record<string, any>) => {
                    if (r.registeredAt && typeof r.registeredAt.toMillis === "function") return r.registeredAt.toMillis();
                    if (r.createdAt && typeof r.createdAt.toMillis === "function") return r.createdAt.toMillis();
                    return 0;
                };

                const getPriorityTier = (r: Record<string, any>): number => {
                    if (confirmedPlayerSet.has(r.playerId)) return 1;
                    if (r.status === "CONFIRMED" || r.originalStatus === "CONFIRMED") {
                        if (!waitlistTeamPlayerSet.has(r.playerId) && !pendingTeamPlayerSet.has(r.playerId)) return 2;
                    }
                    return 3;
                };

                const getTier3Cohort = (r: Record<string, any>): number => {
                    if (waitlistTeamPlayerSet.has(r.playerId)) return 1; // 3A: Waitlist Teams
                    if (pendingTeamPlayerSet.has(r.playerId)) return 2;  // 3B: Pending Teams
                    return 3;                                           // 3C: Solo Free Agents
                };

                const sortedRegs = [...activeRegs].sort((a, b) => {
                    const tierA = getPriorityTier(a);
                    const tierB = getPriorityTier(b);
                    if (tierA !== tierB) return tierA - tierB;

                    if (tierA === 3) {
                        const cohortA = getTier3Cohort(a);
                        const cohortB = getTier3Cohort(b);
                        if (cohortA !== cohortB) return cohortA - cohortB;

                        if (cohortA === 1) {
                            // Cohort 3A: Waitlist Teams - ordered by waitlistSequence ASC, then player1 before player2
                            const seqA = playerWaitlistSeqMap.get(a.playerId) ?? a.waitlistSequence ?? 999999;
                            const seqB = playerWaitlistSeqMap.get(b.playerId) ?? b.waitlistSequence ?? 999999;
                            if (seqA !== seqB) return seqA - seqB;

                            const slotA = playerTeamSlotOrderMap.get(a.playerId) ?? 0;
                            const slotB = playerTeamSlotOrderMap.get(b.playerId) ?? 0;
                            if (slotA !== slotB) return slotA - slotB;
                        } else if (cohortA === 2) {
                            // Cohort 3B: Pending Teams - ordered by team createdAt ASC, then player1 before player2
                            const createdA = playerTeamCreatedMap.get(a.playerId) ?? 0;
                            const createdB = playerTeamCreatedMap.get(b.playerId) ?? 0;
                            if (createdA !== createdB) return createdA - createdB;

                            const slotA = playerTeamSlotOrderMap.get(a.playerId) ?? 0;
                            const slotB = playerTeamSlotOrderMap.get(b.playerId) ?? 0;
                            if (slotA !== slotB) return slotA - slotB;
                        } else {
                            // Cohort 3C: Solo Free Agents - ordered by waitlistPosition (if any), then registeredAt ASC
                            const posA = a.waitlistPosition ?? 999999;
                            const posB = b.waitlistPosition ?? 999999;
                            if (posA !== posB) return posA - posB;
                        }
                    }

                    return getRegMillis(a) - getRegMillis(b);
                });

                for (const reg of sortedRegs) {
                    const regRef = db.collection("registrations").doc(reg.id);
                    if (confirmedCount < newSlots) {
                        confirmedCount++;
                        batch.update(regRef, {
                            status: "CONFIRMED",
                            originalStatus: "CONFIRMED",
                            lookingForPartner: false,
                            partnerStatus: null,
                            waitlistPosition: null,
                            teamId: null,
                            correlationId,
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    } else {
                        waitlistCount++;
                        batch.update(regRef, {
                            status: "WAITLIST",
                            originalStatus: "WAITLIST",
                            lookingForPartner: false,
                            partnerStatus: null,
                            waitlistPosition: waitlistCount,
                            teamId: null,
                            correlationId,
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }
                }

                batch.update(eventRef, {
                    ...baseEventData,
                    registrationsCount: confirmedCount,
                    confirmedTeamsCount: 0,
                    waitlistCount: waitlistCount,
                    unitType: "Players",
                    isTeamRegistration: false,
                });

                // Audit log entry
                const auditRef = db.collection("auditLogs").doc();
                batch.set(auditRef, {
                    eventId,
                    entityType: "EVENT",
                    entityId: eventId,
                    action: "FORMAT_CHANGED_TO_PLAYERS",
                    actorUid: caller.uid,
                    previousState: { unitType: "Teams" },
                    newState: { unitType: "Players", confirmedPlayers: confirmedCount, waitlistPlayers: waitlistCount },
                    reason: "ADMIN_FORMAT_MIGRATION",
                    correlationId,
                    timestamp: FieldValue.serverTimestamp(),
                });

                await batch.commit();
                return NextResponse.json({ success: true, message: "Event converted to Players successfully." });
            } else if (originalUnitType === "Players" && unitType === "Teams") {
                // =========================================================================
                // CASE: PLAYERS --> TEAMS
                // Rule: If teams collection is available, it is the main source of truth.
                // Rule: If teams collection is not available, convert all players to free agents.
                // =========================================================================
                const teamsSnap = await db.collection("teams").where("eventId", "==", eventId).get();

                // Find teams that are active or were format-cancelled (exclude user withdrawals)
                const recoverableTeams = teamsSnap.docs
                    .map((d): Record<string, any> => ({ id: d.id, ...d.data() }))
                    .filter((t) => {
                        if (t.status === "CONFIRMED" || t.status === "WAITLIST" || t.status === "PENDING") return true;
                        if (
                            t.status === "CANCELLED" &&
                            (t.cancelReason === "EVENT_FORMAT_CHANGED_TO_TEAMS" ||
                                t.cancelReason === "EVENT_FORMAT_CHANGED_TO_PLAYERS")
                        ) {
                            return true;
                        }
                        return false;
                    });

                const regsSnap = await db.collection("registrations").where("eventId", "==", eventId).get();
                const activeRegs = regsSnap.docs
                    .map((d): Record<string, any> => ({ id: d.id, ...d.data() }))
                    .filter((r) => r.status !== "CANCELLED");

                if (recoverableTeams.length > 0) {
                    // TEAMS ARE AVAILABLE -> MAIN SOURCE OF TRUTH!
                    const confirmedTeamPlayers = new Map<string, string>(); // playerId -> teamId
                    const waitlistTeamPlayers = new Map<string, { teamId: string; seq: number | null }>();

                    let confirmedTeamsCount = 0;
                    let waitlistTeamsCount = 0;

                    for (const team of recoverableTeams) {
                        const teamRef = db.collection("teams").doc(team.id);
                        // If it was cancelled by format change, restore it
                        if (team.status === "CANCELLED") {
                            // If it had both confirmed players, restore to CONFIRMED or WAITLIST
                            const isConfirmed = !!(team.player1Confirmed && team.player2Confirmed && team.promotedAt);
                            const restoredStatus = isConfirmed ? "CONFIRMED" : "WAITLIST";
                            batch.update(teamRef, {
                                status: restoredStatus,
                                cancelReason: null,
                                cancelledAt: null,
                                correlationId,
                            });
                            if (restoredStatus === "CONFIRMED") {
                                confirmedTeamsCount++;
                                if (team.player1Id) confirmedTeamPlayers.set(team.player1Id, team.id);
                                if (team.player2Id) confirmedTeamPlayers.set(team.player2Id, team.id);
                            } else {
                                waitlistTeamsCount++;
                                if (team.player1Id) waitlistTeamPlayers.set(team.player1Id, { teamId: team.id, seq: team.waitlistSequence || null });
                                if (team.player2Id) waitlistTeamPlayers.set(team.player2Id, { teamId: team.id, seq: team.waitlistSequence || null });
                            }
                        } else if (team.status === "CONFIRMED") {
                            confirmedTeamsCount++;
                            if (team.player1Id) confirmedTeamPlayers.set(team.player1Id, team.id);
                            if (team.player2Id) confirmedTeamPlayers.set(team.player2Id, team.id);
                        } else if (team.status === "WAITLIST") {
                            waitlistTeamsCount++;
                            if (team.player1Id) waitlistTeamPlayers.set(team.player1Id, { teamId: team.id, seq: team.waitlistSequence || null });
                            if (team.player2Id) waitlistTeamPlayers.set(team.player2Id, { teamId: team.id, seq: team.waitlistSequence || null });
                        }
                    }

                    // Map all registrations
                    for (const reg of activeRegs) {
                        const regRef = db.collection("registrations").doc(reg.id);
                        if (confirmedTeamPlayers.has(reg.playerId)) {
                            batch.update(regRef, {
                                status: "CONFIRMED",
                                teamId: confirmedTeamPlayers.get(reg.playerId),
                                lookingForPartner: false,
                                partnerStatus: "CONFIRMED",
                                waitlistPosition: null,
                                correlationId,
                                updatedAt: FieldValue.serverTimestamp(),
                            });
                        } else if (waitlistTeamPlayers.has(reg.playerId)) {
                            const wlInfo = waitlistTeamPlayers.get(reg.playerId)!;
                            batch.update(regRef, {
                                status: "WAITLIST",
                                teamId: wlInfo.teamId,
                                lookingForPartner: false,
                                partnerStatus: "CONFIRMED",
                                waitlistSequence: wlInfo.seq,
                                correlationId,
                                updatedAt: FieldValue.serverTimestamp(),
                            });
                        } else {
                            // Player not in any team -> FREE AGENT
                            const isConfirmed = reg.status === "CONFIRMED" || reg.originalStatus === "CONFIRMED";
                            const isWaitlist = reg.status === "WAITLIST" || reg.originalStatus === "WAITLIST";
                            batch.update(regRef, {
                                status: isConfirmed ? "CONFIRMED" : (isWaitlist ? "WAITLIST" : "PENDING"),
                                originalStatus: isConfirmed ? "CONFIRMED" : (isWaitlist ? "WAITLIST" : (reg.status || "PENDING")),
                                teamId: null,
                                lookingForPartner: true,
                                partnerStatus: "PENDING",
                                waitlistPosition: isWaitlist ? (reg.waitlistPosition ?? null) : null,
                                correlationId,
                                updatedAt: FieldValue.serverTimestamp(),
                            });
                        }
                    }

                    batch.update(eventRef, {
                        ...baseEventData,
                        confirmedTeamsCount,
                        registrationsCount: confirmedTeamsCount,
                        waitlistCount: waitlistTeamsCount,
                        unitType: "Teams",
                        isTeamRegistration: true,
                    });
                } else {
                    // TEAMS ARE NOT AVAILABLE -> CONVERT ALL PLAYERS TO FREE AGENTS
                    // (all players are free agents: confirmed stay confirmed, waitlist stay waitlist, looking for partner = true, no team)
                    for (const reg of activeRegs) {
                        const regRef = db.collection("registrations").doc(reg.id);
                        const isConfirmed = reg.status === "CONFIRMED" || reg.originalStatus === "CONFIRMED";
                        const isWaitlist = reg.status === "WAITLIST" || reg.originalStatus === "WAITLIST";
                        batch.update(regRef, {
                            status: isConfirmed ? "CONFIRMED" : (isWaitlist ? "WAITLIST" : "PENDING"),
                            originalStatus: isConfirmed ? "CONFIRMED" : (isWaitlist ? "WAITLIST" : (reg.status || "PENDING")),
                            teamId: null,
                            lookingForPartner: true,
                            partnerStatus: "PENDING",
                            waitlistPosition: isWaitlist ? (reg.waitlistPosition ?? null) : null,
                            correlationId,
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }

                    batch.update(eventRef, {
                        ...baseEventData,
                        confirmedTeamsCount: 0,
                        registrationsCount: 0,
                        waitlistCount: 0,
                        unitType: "Teams",
                        isTeamRegistration: true,
                    });
                }

                // Audit log entry
                const auditRef = db.collection("auditLogs").doc();
                batch.set(auditRef, {
                    eventId,
                    entityType: "EVENT",
                    entityId: eventId,
                    action: "FORMAT_CHANGED_TO_TEAMS",
                    actorUid: caller.uid,
                    previousState: { unitType: "Players" },
                    newState: { unitType: "Teams", teamsAvailable: recoverableTeams.length > 0 },
                    reason: "ADMIN_FORMAT_MIGRATION",
                    correlationId,
                    timestamp: FieldValue.serverTimestamp(),
                });

                await batch.commit();
                return NextResponse.json({ success: true, message: "Event converted to Teams successfully." });
            }
        }

        // 3. CAPACITY CHANGE CASE (Format did NOT change, but slotsAvailable changed)
        const newSlots = Number(slotsAvailable);
        if (newSlots !== originalSlots && !isCancelled) {
            if (unitType === "Players") {
                const capRes = await adjustIndividualEventCapacity(eventId, newSlots);
                if (!capRes.success) return NextResponse.json({ success: false, error: capRes.error }, { status: 400 });
            } else {
                const capRes = await adjustTeamEventCapacity(eventId, newSlots);
                if (!capRes.success) return NextResponse.json({ success: false, error: capRes.error }, { status: 400 });
            }
        }

        // 4. BASE METADATA UPDATE
        await eventRef.update(baseEventData);

        // Append audit log
        await db.collection("auditLogs").add({
            eventId,
            entityType: "EVENT",
            entityId: eventId,
            action: "EVENT_UPDATED",
            actorUid: caller.uid,
            correlationId,
            timestamp: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ success: true, message: "Event updated successfully." });
    } catch (error) {
        console.error("[API admin event update] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
