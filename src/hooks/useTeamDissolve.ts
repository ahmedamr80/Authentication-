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
    photoURL?: string | null;
    photoUrl?: string;
}

interface SurvivorProfile {
    uid: string;
    fullName?: string;
    displayName?: string;
    photoURL?: string;
    photoUrl?: string;
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
            console.log("   - Current User:", currentUser.displayName || currentUser.fullName || currentUser.uid);

            // -------------------------------------------------------
            // PHASE 1: PRE-FETCHING (Optimized - No Transaction Overhead)
            // -------------------------------------------------------
            console.log("\n📥 PHASE 1: Pre-fetching data...");

            // 1. Find the Current Registration Seat
            const regQuery = query(
                collection(db, "registrations"),
                where("teamId", "==", teamId)
            );
            const regSnap = await getDocs(regQuery);

            if (regSnap.empty) {
                throw new Error("Registration seat not found.");
            }
            const currentRegDoc = regSnap.docs[0];
            const currentRegData = currentRegDoc.data();
            console.log("   ✅ Found registration:", currentRegDoc.id);

            // 2. Identify Role
            const isP1 = currentRegData.playerId === currentUser.uid;
            const isP2 = currentRegData.player2Id === currentUser.uid;

            if (!isP1 && !isP2) {
                throw new Error("User is not part of this team");
            }

            // -------------------------------------------------------
            // 🧠 CORE LOGIC: DETERMINING THE SURVIVOR
            // Based on the Scenario Table:
            // - DECLINE: Survivor is the Captain (P1)
            // - CANCEL: Survivor is the Actor/Captain (P1)
            // - LEAVE + PENDING + isP1: No Survivor (full delete)
            // - LEAVE (standard): Survivor is the other person
            // -------------------------------------------------------
            let survivorId: string | null = null;

            // Scenario 1: Partner Declines Invite (Action: DECLINE, Actor: P2)
            if (actionType === "DECLINE") {
                // Survivor is the Captain (P1)
                survivorId = currentRegData.playerId;
                console.log("   🎯 DECLINE scenario: Captain (P1) survives");
            }
            // Scenario 3: Captain Cancels Invite (Action: CANCEL, Actor: P1)
            else if (actionType === "CANCEL") {
                // Survivor is the Actor/Captain (P1)
                // Note: P1 is "kicking" P2, but keeping the seat.
                survivorId = currentUser.uid;
                console.log("   🎯 CANCEL scenario: Actor (Captain) survives, invitation cancelled");
            }
            // Scenario 2: Captain Withdraws from Pending (Action: LEAVE, Actor: P1, Status: PENDING)
            else if (actionType === "LEAVE" && currentRegData.status === "PENDING" && isP1) {
                // Whole record deleted. No survivor.
                survivorId = null;
                console.log("   🎯 WITHDRAW scenario: No survivor - full deletion");
            }
            // Scenario 4, 5, 6: Standard LEAVE (Confirmed/Waitlist/Partner Leaves)
            else if (actionType === "LEAVE") {
                // Survivor is the *other* person
                survivorId = isP1 ? currentRegData.player2Id : currentRegData.playerId;
                console.log("   🎯 LEAVE scenario: Other player survives");
            }

            console.log("\n🔍 Survivor Strategy:");
            console.log("   - Scenario Action:", actionType);
            console.log("   - Actor Is P1?", isP1);
            console.log("   - Survivor ID:", survivorId || "NONE (Full Delete)");

            // 3. Pre-fetch Survivor Profile (Avoids reading users collection in transaction)
            let survivorProfileData: SurvivorProfile | null = null;

            if (survivorId) {
                console.log("   👤 Pre-fetching survivor profile...");
                const userRef = doc(db, "users", survivorId);
                const userSnap = await getDoc(userRef);

                if (userSnap.exists()) {
                    survivorProfileData = userSnap.data() as SurvivorProfile;
                    console.log("   ✅ Survivor profile loaded:", survivorProfileData.fullName || survivorProfileData.displayName);
                } else {
                    console.log("   ⚠️ Survivor profile not found in users collection");
                }
            }

            // 4. Find the Top Waitlist Candidate Team
            const waitlistQuery = query(
                collection(db, "teams"),
                where("eventId", "==", eventId),
                where("status", "==", STATUS.WAITLIST),
                orderBy("createdAt", "asc"),
                limit(1)
            );
            const waitlistSnap = await getDocs(waitlistQuery);
            const candidateTeamDoc = !waitlistSnap.empty ? waitlistSnap.docs[0] : null;

            if (candidateTeamDoc) {
                console.log("   ✅ Found waitlist candidate team:", candidateTeamDoc.id);
            } else {
                console.log("   ℹ️ No waitlist candidates available");
            }

            // 5. Find the Candidate's Registration
            let candidateRegDoc = null;
            if (candidateTeamDoc) {
                const candRegQuery = query(
                    collection(db, "registrations"),
                    where("teamId", "==", candidateTeamDoc.id)
                );
                const candRegSnap = await getDocs(candRegQuery);
                if (!candRegSnap.empty) {
                    candidateRegDoc = candRegSnap.docs[0];
                    console.log("   ✅ Found candidate registration:", candidateRegDoc.id);
                }
            }

            // -------------------------------------------------------
            // PHASE 2: ATOMIC TRANSACTION
            // -------------------------------------------------------
            console.log("\n⚡ PHASE 2: Starting atomic transaction...");

            await runTransaction(db, async (transaction) => {
                // A. Document References
                const teamRef = doc(db, "teams", teamId);
                const eventRef = doc(db, "events", eventId);
                const regRef = doc(db, "registrations", currentRegDoc.id);

                // OPTIMISTIC READS: Candidate Team & Registration
                // We must read these BEFORE any writes if we plan to use them.
                let candTeamSnap = null;
                let candRegSnap = null;

                if (candidateTeamDoc) {
                    const candTeamRef = doc(db, "teams", candidateTeamDoc.id);
                    candTeamSnap = await transaction.get(candTeamRef);
                }

                if (candidateRegDoc) {
                    const candRegRef = doc(db, "registrations", candidateRegDoc.id);
                    candRegSnap = await transaction.get(candRegRef);
                }

                // B. Transaction Reads (Must come before writes)
                const teamDocSnap = await transaction.get(teamRef);
                const eventDocSnap = await transaction.get(eventRef);
                const regDocSnap = await transaction.get(regRef);

                // C. Safety Checks & Early Exit
                if (!teamDocSnap.exists()) {
                    console.log("   ⚠️ Team already deleted (race condition), cleaning up notification only");
                    if (notificationId) {
                        transaction.update(doc(db, "notifications", notificationId), { read: true });
                    }
                    return; // Graceful exit
                }

                if (!eventDocSnap.exists()) {
                    throw new Error("Event not found.");
                }

                if (!regDocSnap.exists()) {
                    throw new Error("Registration not found.");
                }

                const teamData = teamDocSnap.data();
                const eventData = eventDocSnap.data();
                const regData = regDocSnap.data();

                console.log("\n👥 Team Data:");
                console.log("   - P1:", teamData.player1Id);
                console.log("   - P2:", teamData.player2Id || "None");
                console.log("   - Status:", teamData.status);

                // D. Prepare Survivor Data (Using Pre-fetched Profile or Fallback)
                let survivorName = "Unknown Player";
                let survivorPhoto: string | null = null;

                if (survivorId) {
                    if (survivorProfileData) {
                        // Use pre-fetched profile data
                        survivorName = survivorProfileData.fullName
                            || survivorProfileData.displayName
                            || "Unknown Player";
                        survivorPhoto = survivorProfileData.photoURL
                            || survivorProfileData.photoUrl
                            || null;
                        console.log("   ✅ Using pre-fetched survivor profile");
                    } else {
                        // Fallback to Team/Registration data
                        console.log("   ⚠️ Using fallback survivor data from registration");
                        // If survivor is P1 (Captain staying), use P1 data
                        if (survivorId === currentRegData.playerId) {
                            survivorName = currentRegData.fullNameP1 || "Unknown Player";
                            survivorPhoto = currentRegData.playerPhotoURL || null;
                        } else {
                            survivorName = currentRegData.fullNameP2 || teamData.player2?.displayName || "Unknown Player";
                            survivorPhoto = currentRegData.player2PhotoURL || teamData.player2?.photoURL || null;
                        }
                    }

                    console.log("   👤 Survivor Details:");
                    console.log("      - Name:", survivorName);
                    console.log("      - Photo:", survivorPhoto ? "Yes" : "No");
                }

                // -------------------------------------------------------
                // TRANSACTION WRITES
                // -------------------------------------------------------
                console.log("\n🔧 Processing dissolution logic...");

                // 1. Handle Registration (Normalize Survivor or Delete)
                if (survivorId) {
                    console.log("   📝 Normalizing survivor registration (survivor → solo player in P1 slot)");
                    transaction.update(regRef, {
                        // Normalize Survivor to P1 Slot (always put survivor in P1 position)
                        playerId: survivorId,
                        fullNameP1: survivorName,
                        playerPhotoURL: survivorPhoto,
                        isPrimary: true,

                        // Reset Team Status
                        teamId: null, // Detach from dissolved team
                        lookingForPartner: true, // Back to free agent market
                        partnerStatus: "NONE",
                        status: regData.status, // Keep existing status (CONFIRMED/WAITLIST/PENDING)

                        // Clear P2 Slot completely
                        player2Id: null,
                        fullNameP2: null,
                        player2Confirmed: false,
                        player2PhotoURL: null,
                        invite: null,

                        // Metadata
                        _debugSource: `useTeamDissolve - ${actionType} - Survivor Normalized`,
                        _lastUpdated: serverTimestamp()
                    });
                } else {
                    // Scenario 2: Captain Withdraws (No Survivor)
                    console.log("   🗑️ No survivor - deleting registration completely");
                    transaction.delete(regRef);
                }

                // 2. Determine Slot Impact
                const teamStatus = teamData.status;
                let slotOpened = false;
                let waitlistSpotFreed = false;

                console.log("\n📊 Slot Management Analysis:");
                console.log("   - Team Status:", teamStatus);
                console.log("   - Action Type:", actionType);

                // IMPORTANT: If Action was CANCEL (Scenario 3), the registration remains.
                // Therefore, NO slot opens, even if the team was Pending.
                // The Captain holds the slot.
                if (actionType === "CANCEL") {
                    slotOpened = false;
                    waitlistSpotFreed = false;
                    console.log("   ℹ️ CANCEL action - Captain keeps registration, no slot impact");
                } else {
                    // Normal logic for LEAVE/DECLINE
                    if (teamStatus === STATUS.CONFIRMED) {
                        slotOpened = true;
                        console.log("   ✅ Confirmed team dissolved - slot opens!");
                    } else if (teamStatus === STATUS.WAITLIST) {
                        waitlistSpotFreed = true;
                        slotOpened = false;
                        console.log("   ✅ Waitlist team dissolved - waitlist spot freed!");
                    } else if (teamStatus === STATUS.PENDING) {
                        if (actionType === "DECLINE") {
                            // PENDING team declined = no slot impact
                            slotOpened = false;
                            waitlistSpotFreed = false;
                            console.log("   ℹ️ Pending team declined - no slot/waitlist impact");
                        } else {
                            // LEAVE from PENDING (rare but possible)
                            slotOpened = false;
                            waitlistSpotFreed = false;
                            console.log("   ℹ️ Pending team left - no slot/waitlist impact");
                        }
                    }
                }

                console.log("   - Slot Opened?", slotOpened);
                console.log("   - Waitlist Freed?", waitlistSpotFreed);

                // 3. Handle Event Counts & Waitlist Promotion
                if (slotOpened) {
                    console.log("\n🎯 Processing slot opening...");

                    // CHECK: Do we have valid candidate snapshots from our optimistic reads?
                    if (candTeamSnap && candTeamSnap.exists() && candRegSnap && candRegSnap.exists()) {
                        console.log("   🔄 Attempting to promote waitlist candidate...");

                        const candData = candTeamSnap.data();
                        const candTeamRef = candTeamSnap.ref;
                        const candRegRef = candRegSnap.ref;

                        console.log("   ✅ Promoting team to CONFIRMED");
                        console.log("      - Team ID:", candTeamSnap.id);
                        console.log("      - P1:", candData.player1Id);
                        console.log("      - P2:", candData.player2Id || "None");

                        // EXECUTE PROMOTION
                        transaction.update(candTeamRef, {
                            status: STATUS.CONFIRMED,
                            promotedAt: serverTimestamp()
                        });

                        transaction.update(candRegRef, {
                            status: STATUS.CONFIRMED,
                            waitlistPosition: null,
                            promotedAt: serverTimestamp()
                        });

                        // Update Event Counts (Waitlist down, Registrations stay same - swap)
                        const currentWaitlist = eventData.waitlistCount || 0;
                        transaction.update(eventRef, {
                            waitlistCount: Math.max(0, currentWaitlist - 1)
                        });

                        console.log("   📊 Event Waiting list counts updated:");
                        console.log("      - Waitlist:", currentWaitlist, "→", Math.max(0, currentWaitlist - 1));
                        console.log("      - Registrations: unchanged (1 out, 1 in = swap)");

                        // Notify Promoted P1 (Captain)
                        console.log("   📧 Sending promotion notifications...");
                        const p1NotifRef = doc(collection(db, "notifications"));
                        transaction.set(p1NotifRef, {
                            notificationId: p1NotifRef.id,
                            userId: candData.player1Id,
                            type: NOTIFICATION_TYPE.SYSTEM,
                            title: "You're In! 🎉",
                            message: `A slot opened up! Your team has been promoted to CONFIRMED for ${eventData.eventName}.`,
                            eventId: eventId,
                            read: false,
                            createdAt: serverTimestamp()
                        });
                        console.log("      - ✅ Notified P1:", candData.player1Id);

                        // Notify Promoted P2 (Partner) if exists
                        if (candData.player2Id) {
                            const p2NotifRef = doc(collection(db, "notifications"));
                            transaction.set(p2NotifRef, {
                                notificationId: p2NotifRef.id,
                                userId: candData.player2Id,
                                type: NOTIFICATION_TYPE.SYSTEM,
                                title: "You're In! 🎉",
                                message: `A slot opened up! Your team has been promoted to CONFIRMED for ${eventData.eventName}.`,
                                eventId: eventId,
                                read: false,
                                createdAt: serverTimestamp()
                            });
                            console.log("      - ✅ Notified P2:", candData.player2Id);
                        }
                    } else {
                        // No valid candidate found or candidate data missing
                        console.log("   ℹ️ No waitlist candidates or candidate data invalid, opening slot to public");
                        const currentRegs = eventData.registrationsCount || 0;
                        transaction.update(eventRef, {
                            registrationsCount: Math.max(0, currentRegs - 1)
                        });
                        console.log("   📊 Registrations:", currentRegs, "→", Math.max(0, currentRegs - 1));
                    }
                } else if (waitlistSpotFreed) {
                    console.log("\n📉 Freeing waitlist spot...");
                    const currentWaitlist = eventData.waitlistCount || 0;
                    transaction.update(eventRef, {
                        waitlistCount: Math.max(0, currentWaitlist - 1)
                    });
                    console.log("   📊 Waitlist:", currentWaitlist, "→", Math.max(0, currentWaitlist - 1));
                }

                // 4. Cleanup & Notifications
                console.log("\n🧹 Cleanup operations...");

                // Delete the team document
                transaction.delete(teamRef);
                console.log("   ✅ Team deleted:", teamId);

                // Mark originating notification as read
                if (notificationId) {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                    console.log("   ✅ Notification marked as read:", notificationId);
                }

                // -------------------------------------------------------
                // SCENARIO-BASED NOTIFICATIONS
                // -------------------------------------------------------

                // Scenario 3 (CANCEL): Notify P2 (The victim of cancellation)
                if (actionType === "CANCEL" && teamData.player2Id) {
                    console.log("   📧 Notifying cancelled partner...");
                    const notifRef = doc(collection(db, "notifications"));
                    transaction.set(notifRef, {
                        notificationId: notifRef.id,
                        userId: teamData.player2Id,
                        type: NOTIFICATION_TYPE.SYSTEM,
                        title: "Invitation Canceled",
                        message: `${currentUser.displayName || currentUser.fullName || "The Captain"} canceled the invitation for ${eventData.eventName}.`,
                        eventId: eventId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                    console.log("   ✅ Cancelled partner notified:", teamData.player2Id);
                }

                // Scenario 2 (WITHDRAW - LEAVE with no survivor): Notify P2 (if exists)
                if (actionType === "LEAVE" && !survivorId && teamData.player2Id) {
                    console.log("   📧 Notifying partner about withdrawal...");
                    const notifRef = doc(collection(db, "notifications"));
                    transaction.set(notifRef, {
                        notificationId: notifRef.id,
                        userId: teamData.player2Id,
                        type: NOTIFICATION_TYPE.SYSTEM,
                        title: "Team Cancelled",
                        message: `${currentUser.displayName || currentUser.fullName || "Your partner"} withdrew the team application for ${eventData.eventName}.`,
                        eventId: eventId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                    console.log("   ✅ Partner notified about withdrawal:", teamData.player2Id);
                }

                // Scenario 1 (DECLINE) and Scenario 4,5,6 (LEAVE with survivor): Notify Survivor
                if ((actionType === "DECLINE" || actionType === "LEAVE") && survivorId) {
                    console.log("   📧 Notifying survivor...");
                    const replyNotifRef = doc(collection(db, "notifications"));

                    const title = actionType === "DECLINE"
                        ? "Invitation Declined"
                        : "Partner Left";

                    const msg = actionType === "DECLINE"
                        ? `${currentUser.displayName || currentUser.fullName || "Your partner"} declined the team invitation. You're now a free agent looking for a partner.`
                        : `${currentUser.displayName || currentUser.fullName || "Your partner"} left the team. You're now a free agent looking for a partner.`;

                    transaction.set(replyNotifRef, {
                        notificationId: replyNotifRef.id,
                        userId: survivorId,
                        type: actionType === "DECLINE"
                            ? NOTIFICATION_TYPE.PARTNER_DECLINED
                            : NOTIFICATION_TYPE.SYSTEM,
                        title: title,
                        message: msg,
                        eventId: eventId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                    console.log("   ✅ Survivor notified:", survivorId);
                }

                console.log("\n✅ Transaction completed successfully!");
            });

            console.log("\n🎉 Team dissolution completed successfully!");
            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("\n❌ Dissolve Error:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to dissolve team.";
            setError(errorMessage);
            throw err; // Re-throw for UI error handling
        } finally {
            setLoading(false);
        }
    };

    return { dissolveTeam, loading, error };
};