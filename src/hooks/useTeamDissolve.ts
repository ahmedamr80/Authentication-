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
                    return;
                }

                if (!eventDocSnap.exists()) throw new Error("Event not found.");
                if (!regDocSnap.exists()) throw new Error("Registration not found.");

                const teamData = teamDocSnap.data();
                const eventData = eventDocSnap.data();
                const regData = regDocSnap.data();

                // D. Prepare Survivor Data
                let survivorName = "Unknown Player";
                let survivorPhoto: string | null = null;

                if (survivorId) {
                    if (survivorProfileData) {
                        survivorName = survivorProfileData.fullName || survivorProfileData.displayName || "Unknown Player";
                        survivorPhoto = survivorProfileData.photoURL || survivorProfileData.photoUrl || null;
                    } else {
                        if (survivorId === currentRegData.playerId) {
                            survivorName = currentRegData.fullNameP1 || "Unknown Player";
                            survivorPhoto = currentRegData.playerPhotoURL || null;
                        } else {
                            survivorName = currentRegData.fullNameP2 || teamData.player2?.displayName || "Unknown Player";
                            survivorPhoto = currentRegData.player2PhotoURL || teamData.player2?.photoURL || null;
                        }
                    }
                }

                // E. writes
                if (survivorId) {
                    transaction.update(regRef, {
                        playerId: survivorId,
                        fullNameP1: survivorName,
                        playerPhotoURL: survivorPhoto,
                        isPrimary: true,
                        teamId: null,
                        lookingForPartner: true,
                        partnerStatus: "NONE",
                        status: regData.status,
                        player2Id: null,
                        fullNameP2: null,
                        player2Confirmed: false,
                        player2PhotoURL: null,
                        invite: null,
                        _debugSource: `useTeamDissolve - ${actionType} - Survivor Normalized`,
                        _lastUpdated: serverTimestamp()
                    });
                } else {
                    transaction.delete(regRef);
                }

                // Impact analysis
                const teamStatus = teamData.status;
                let slotOpened = false;
                let waitlistSpotFreed = false;

                if (actionType === "CANCEL") {
                    slotOpened = false;
                    waitlistSpotFreed = false;
                } else {
                    if (teamStatus === STATUS.CONFIRMED) {
                        slotOpened = true;
                    } else if (teamStatus === STATUS.WAITLIST) {
                        waitlistSpotFreed = true;
                    }
                }

                if (slotOpened) {
                    if (candTeamSnap && candTeamSnap.exists() && candRegSnap && candRegSnap.exists()) {
                        const candData = candTeamSnap.data();
                        transaction.update(candTeamSnap.ref, { status: STATUS.CONFIRMED, promotedAt: serverTimestamp() });
                        transaction.update(candRegSnap.ref, { status: STATUS.CONFIRMED, waitlistPosition: null, promotedAt: serverTimestamp() });
                        transaction.update(eventRef, { waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1) });

                        // Notifications
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
                        }
                    } else {
                        transaction.update(eventRef, { registrationsCount: Math.max(0, (eventData.registrationsCount || 0) - 1) });
                    }
                } else if (waitlistSpotFreed) {
                    transaction.update(eventRef, { waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1) });
                }

                transaction.delete(teamRef);
                if (notificationId) {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                }

                // Dynamic Notifications
                if (actionType === "CANCEL" && teamData.player2Id) {
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
                }

                if (actionType === "LEAVE" && !survivorId && teamData.player2Id) {
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
                }

                if ((actionType === "DECLINE" || actionType === "LEAVE") && survivorId) {
                    const replyNotifRef = doc(collection(db, "notifications"));
                    transaction.set(replyNotifRef, {
                        notificationId: replyNotifRef.id,
                        userId: survivorId,
                        type: actionType === "DECLINE" ? NOTIFICATION_TYPE.PARTNER_DECLINED : NOTIFICATION_TYPE.SYSTEM,
                        title: actionType === "DECLINE" ? "Invitation Declined" : "Partner Left",
                        message: actionType === "DECLINE"
                            ? `${currentUser.displayName || currentUser.fullName || "Your partner"} declined the team invitation. You're now a free agent looking for a partner.`
                            : `${currentUser.displayName || currentUser.fullName || "Your partner"} left the team. You're now a free agent looking for a partner.`,
                        eventId: eventId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                }
            });

            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("\n❌ Dissolve Error:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to dissolve team.";
            setError(errorMessage);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return { dissolveTeam, loading, error };
};