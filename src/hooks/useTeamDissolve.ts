import { useState } from "react";
import {
    doc,
    runTransaction,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    getDoc,
    serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";

// Constants to avoid magic strings
const STATUS = {
    CONFIRMED: "CONFIRMED",
    WAITLIST: "WAITLIST",
    PENDING: "PENDING",
    CANCELLED: "CANCELLED"
} as const;

const NOTIFICATION_TYPE = {
    SYSTEM: "system",
    PARTNER_DECLINED: "partner_declined",
    WAITLIST_PROMOTED: "waitlist_promoted"
} as const;

export interface DissolveUser {
    uid: string;
    fullName?: string;
    displayName?: string | null;
    // photoURL?: string | null;
    //  photoUrl?: string;
}

interface SurvivorProfile {
    uid: string;
    fullName?: string;
    displayName?: string;
    //  photoURL?: string;
    //  photoUrl?: string;
}

// EXPANDED: Action Types to match the Scenario Table
export type DissolveAction = "DECLINE" | "LEAVE" | "CANCEL";

export const useTeamDissolve = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dissolveTeam = async (
        currentUser: DissolveUser,
        teamId: string,
        eventId: string,
        actionType: DissolveAction,
        notificationId?: string,
        onSuccess?: () => void
    ) => {
        setLoading(true);
        setError(null);

        try {
            console.log(`🚀 Processing Dissolve: ${actionType}`);
            console.log("   - Team ID:", teamId);
            console.log("   - Event ID:", eventId);

            // -------------------------------------------------------
            // PHASE 1: PRE-FETCHING
            // -------------------------------------------------------
            console.log("\n📥 PHASE 1: Pre-fetching data...");

            // 1. Fetch Team Document (Essential to know who P2 is)
            const teamRef = doc(db, "teams", teamId);
            const teamSnap = await getDoc(teamRef);
            if (!teamSnap.exists()) {
                console.warn("⚠️ Team not found, might be already deleted.");
                if (notificationId) {
                    await runTransaction(db, async (t) => {
                        t.update(doc(db, "notifications", notificationId), { read: true });
                    });
                }
                onSuccess?.();
                return;
            }
            const teamData = teamSnap.data();
            console.log("   ✅ Found Team:", teamId);

            // 2. Fetch "Current" Registration (Linked to this team)
            // This is the registration that is "holding" the seat for the team usually.
            const regQuery = query(
                collection(db, "registrations"),
                where("teamId", "==", teamId)
            );
            const regSnap = await getDocs(regQuery);

            if (regSnap.empty) {
                // For MERGE_P1 or loose invites, there might be no registration linked to the teamId yet.
                // This is fine, we just proceed with Team deletion.
                console.log("   ℹ️ No registration linked to this team (likely pure specific invite).");
            }
            const currentRegDoc = !regSnap.empty ? regSnap.docs[0] : null;
            const currentRegData = currentRegDoc ? currentRegDoc.data() : null;

            // 3. Identify Players
            const p1Id = teamData.player1Id;
            const p2Id = teamData.player2Id;
            const isP1 = currentUser.uid === p1Id;
            const isP2 = currentUser.uid === p2Id;

            if (!isP1 && !isP2) throw new Error("User is not part of this team");

            // 4. CHECK PARTNER REGISTRATION (Crucial for Scenario 6)
            // We need to know if the "Other" player has their own independent registration.
            const otherPlayerId = isP1 ? p2Id : p1Id;
            let otherPlayerRegDoc = null;

            if (otherPlayerId) {
                const otherRegQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", eventId),
                    where("playerId", "==", otherPlayerId) // Look for them as Primary
                );
                const otherSnap = await getDocs(otherRegQuery);
                // We only care if they are primary (independent reg)
                if (!otherSnap.empty) {
                    otherPlayerRegDoc = otherSnap.docs[0];
                    console.log(`   ✅ Partner (${otherPlayerId}) has their own registration:`, otherPlayerRegDoc.id);
                }
            }

            // -------------------------------------------------------
            // 🧠 CORE LOGIC: DETERMINING THE SURVIVOR & STRATEGY
            // -------------------------------------------------------
            let survivorId: string | null = null;
            let strategy: "PROMOTE_SURVIVOR" | "REVERT_PARTNER" | "DELETE_ALL" = "DELETE_ALL";

            // Scenario 1: Partner Declines Invite (Action: DECLINE, Actor: P2)
            if (actionType === "DECLINE") {
                survivorId = p1Id;
                strategy = "PROMOTE_SURVIVOR"; // Setup P1 as Solo
                console.log("   🎯 DECLINE: P1 survives.");
            }
            // Scenario 3: Captain Cancels Invite (Action: CANCEL, Actor: P1)
            else if (actionType === "CANCEL") {
                survivorId = p1Id;
                strategy = "PROMOTE_SURVIVOR"; // P1 stays, P2 dropped
                console.log("   🎯 CANCEL: P1 survives.");
            }
            // Scenario 6: Pending Team Leaves (Action: LEAVE, Team: PENDING)
            else if (actionType === "LEAVE" && teamData.status === "PENDING") {
                // If I am P1 and I leave...
                if (isP1) {
                    // Does P2 have a registration?
                    if (otherPlayerRegDoc) {
                        // Yes -> P2 reverts to their old registration.
                        survivorId = p2Id; // Just for notification tracking
                        strategy = "REVERT_PARTNER";
                        console.log("   🎯 SCENARIO 6 (MERGE): P1 Left. P2 has reg -> REVERT P2.");
                    } else if (currentRegDoc) {
                        // REGULAR FRESH INVITE (Linked Reg exists)
                        survivorId = p2Id;
                        strategy = "PROMOTE_SURVIVOR";
                        console.log("   🎯 SCENARIO 6 (FRESH): P1 Left. P2 has NO reg but Shared Reg exists -> PROMOTE P2.");
                    } else {
                        // NO REGISTRATION exists (Loose invite)
                        // P2 has no reg, P1 has no reg (linked).
                        // Likely just delete team.
                        survivorId = p2Id;
                        strategy = "DELETE_ALL"; // Nothing to promote to.
                        console.log("   🎯 SCENARIO 6 (LOOSE): P1 Left. No registrations -> Delete Team.");
                    }
                }
                // If I am P2 and I leave... (Same as DECLINE essentially)
                else {
                    survivorId = p1Id;
                    strategy = "PROMOTE_SURVIVOR"; // P1 stays
                }
            }
            // Standard LEAVE (Confirmed/Waitlist)
            else if (actionType === "LEAVE") {
                survivorId = otherPlayerId;
                strategy = "PROMOTE_SURVIVOR"; // Normal behavior: P1 leaves, P2 takes over spot
                console.log("   🎯 STANDARD LEAVE: Partner survives.");
            }

            // 5. Waitlist Logic (for filling the hole)
            // ... (Same as before)
            const waitlistQuery = query(
                collection(db, "teams"),
                where("eventId", "==", eventId),
                where("status", "==", STATUS.WAITLIST),
                orderBy("createdAt", "asc"),
                limit(1)
            );
            const waitlistSnap = await getDocs(waitlistQuery);
            const candidateTeamDoc = !waitlistSnap.empty ? waitlistSnap.docs[0] : null;
            let candidateRegDoc = null;
            if (candidateTeamDoc) {
                const candRegQuery = query(collection(db, "registrations"), where("teamId", "==", candidateTeamDoc.id));
                const candRegSnap = await getDocs(candRegQuery);
                if (!candRegSnap.empty) candidateRegDoc = candRegSnap.docs[0];
            }

            // -------------------------------------------------------
            // PHASE 2: TRANSACTION
            // -------------------------------------------------------
            await runTransaction(db, async (transaction) => {
                const eventRef = doc(db, "events", eventId);
                const eventDocSnap = await transaction.get(eventRef);
                if (!eventDocSnap.exists()) throw new Error("Event not found");
                const eventData = eventDocSnap.data();

                // Fetch regDoc if we have a reference to it
                let regSnap = null;
                let regRef = null;
                if (currentRegDoc) {
                    regRef = doc(db, "registrations", currentRegDoc.id);
                    regSnap = await transaction.get(regRef);
                }

                // --- ALL READS COMPLETE. START WRITES ---

                // 1. Handle Team Deletion
                transaction.delete(teamRef);

                // 2. Handle Current Registration (The joint one or P1's)
                if (regSnap && regSnap.exists() && regRef) {
                    if (strategy === "PROMOTE_SURVIVOR" && survivorId) {
                        // "Promote" the survivor into this seat
                        // We need survivor details. If it's P2, fetch from teamData or profile.
                        let sName = "Unknown";
                        //  let sPhoto = null;

                        if (survivorId === p1Id) {
                            sName = teamData.fullNameP1 || currentRegData?.fullNameP1;
                            //     sPhoto = currentRegData?.playerPhotoURL || null;
                        } else {
                            sName = teamData.fullNameP2 || currentRegData?.fullNameP2;
                            //     sPhoto = teamData.player2?.photoURL || currentRegData?.player2PhotoURL || null;
                        }

                        transaction.update(regRef, {
                            playerId: survivorId,
                            fullNameP1: sName,
                            //   playerPhotoURL: sPhoto,
                            isPrimary: true,
                            teamId: null,
                            lookingForPartner: true,
                            partnerStatus: "NONE",
                            // status: KEEP EXISTING (Confirmed/Waitlist)
                            player2Id: null,
                            fullNameP2: null,
                            player2Confirmed: false,
                            player2PhotoURL: null,
                            invite: null,
                            _debugSource: "useTeamDissolve - PROMOTE",
                            _lastUpdated: serverTimestamp()
                        });
                    } else if (strategy === "DELETE_ALL") {
                        transaction.delete(regRef);
                    } else if (strategy === "REVERT_PARTNER") {
                        // The current reg (P1's) is deleted/cleaned because P1 left.
                        transaction.delete(regRef);
                    }
                }

                // 3. Handle Independent Partner Registration (REVERT_PARTNER)
                if (strategy === "REVERT_PARTNER" && otherPlayerRegDoc) {
                    const pRegRef = doc(db, "registrations", otherPlayerRegDoc.id);
                    transaction.update(pRegRef, {
                        teamId: null, // Detach from the deleted team
                        partnerStatus: "NONE",
                        lookingForPartner: true, // Back to market
                        invite: null,
                        _debugSource: "useTeamDissolve - REVERT",
                        _lastUpdated: serverTimestamp()
                    });
                }

                // 4. Fill Slots (If Confirmed Team Dissolved)
                const slotOpened = teamData.status === STATUS.CONFIRMED && actionType !== "CANCEL";
                const waitlistSpotFreed = teamData.status === STATUS.WAITLIST && actionType !== "CANCEL";

                if (slotOpened) {
                    if (candidateTeamDoc && candidateRegDoc) {
                        // Promote Waitlist Team
                        transaction.update(doc(db, "teams", candidateTeamDoc.id), { status: STATUS.CONFIRMED, promotedAt: serverTimestamp() });
                        transaction.update(doc(db, "registrations", candidateRegDoc.id), { status: STATUS.CONFIRMED, waitlistPosition: null, promotedAt: serverTimestamp() });
                        transaction.update(eventRef, { waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1) });
                        // Notify... (Simplified for brevity, same logic as before)
                    } else {
                        transaction.update(eventRef, { registrationsCount: Math.max(0, (eventData.registrationsCount || 0) - 1) });
                    }
                } else if (waitlistSpotFreed) {
                    transaction.update(eventRef, { waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1) });
                }

                // 5. Notifications
                if (notificationId) {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                }
                // Send "Partner Left" notifications to Survivor...
                const eventDateFormatted = eventData.dateTime?.toDate().toLocaleDateString('en-GB') || 'Date';
                if (survivorId) {
                    const notifRef = doc(collection(db, "notifications"));
                    transaction.set(notifRef, {
                        notificationId: notifRef.id,
                        userId: survivorId,
                        type: "system",
                        title: "Partner Update",
                        message: `for Event ${eventData.eventName}, ${actionType === "DECLINE" ? "Partner declined" : "Partner left"}. You are now a free agent.`,
                        eventId: eventId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                }
            });

            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("\n❌ Dissolve Error:", err);
            setError(err instanceof Error ? err.message : "Failed to dissolve team.");
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return { dissolveTeam, loading, error };
};