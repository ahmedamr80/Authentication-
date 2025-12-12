import { useState } from "react";
import {
    doc,
    runTransaction,
    collection,
    Timestamp,
    query,
    where,
    orderBy,
    limit,
    getDocs
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface DissolveUser {
    uid: string;
    displayName?: string | null;
    photoURL?: string | null;
}

export const useTeamDissolve = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dissolveTeam = async (
        currentUser: DissolveUser,
        teamId: string,
        eventId: string,
        actionType: "DECLINE" | "LEAVE",
        notificationId?: string,
        onSuccess?: () => void
    ) => {
        setLoading(true);
        setError(null);

        try {
            // -------------------------------------------------------
            // PRE-TRANSACTION: Find the Waitlist Candidate (FIFO)
            // -------------------------------------------------------
            const regsRef = collection(db, "registrations");
            const waitlistQuery = query(
                regsRef,
                where("eventId", "==", eventId),
                where("status", "==", "WAITLIST"),
                where("isPrimary", "==", true),
                orderBy("waitlistPosition", "asc"),
                limit(1)
            );

            const waitlistSnap = await getDocs(waitlistQuery);
            const candidateDoc = !waitlistSnap.empty ? waitlistSnap.docs[0] : null;

            // -------------------------------------------------------
            // START TRANSACTION
            // -------------------------------------------------------
            await runTransaction(db, async (transaction) => {
                // 1. Get Team & Event Data
                const teamRef = doc(db, "teams", teamId);
                const eventRef = doc(db, "events", eventId);

                const teamDoc = await transaction.get(teamRef);
                const eventDoc = await transaction.get(eventRef);

                if (!teamDoc.exists()) throw new Error("Team not found.");
                if (!eventDoc.exists()) throw new Error("Event not found.");

                const eventData = eventDoc.data();

                // 2. Find Current User's Registration
                const q = query(regsRef, where("teamId", "==", teamId));
                const regSnap = await getDocs(q);
                if (regSnap.empty) throw new Error("Registration not found.");

                const regDoc = regSnap.docs[0];
                const regData = regDoc.data();
                const regDocRef = doc(db, "registrations", regDoc.id);

                // 3. Logic: Determine Survivor (Who stays in the slot?)
                const isCurrentP1 = regData.playerId === currentUser.uid;

                // If P1 is current user (leaving), Survivor is P2.
                // If P2 is current user (leaving), Survivor is P1.
                let survivorId = isCurrentP1 ? regData.player2Id : regData.playerId;

                // Edge Case: If P1 leaves and there is NO P2, slot is abandoned (No survivor).
                if (actionType === "LEAVE" && !regData.player2Id && isCurrentP1) {
                    survivorId = null;
                }

                // 4. FETCH SURVIVOR PROFILE (SOURCE OF TRUTH)
                let survivorName = "Unknown Player";
                let survivorPhoto = null;

                if (survivorId) {
                    // Look up the survivor in the 'users' collection to get the real name
                    const userRef = doc(db, "users", survivorId);
                    const userDoc = await transaction.get(userRef);

                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        // Priority: fullName -> displayName -> Registration Fallback -> "Unknown"
                        survivorName = userData.fullName || userData.displayName ||
                            (isCurrentP1 ? regData.fullNameP2 : regData.fullNameP1) ||
                            "Unknown Player";
                        survivorPhoto = userData.photoURL ||
                            (isCurrentP1 ? regData.player2PhotoURL : regData.playerPhotoURL) ||
                            null;
                    } else {
                        // Fallback if user profile is missing (shouldn't happen, but safe)
                        survivorName = isCurrentP1 ? (regData.fullNameP2 || "Unknown Player") : (regData.fullNameP1 || "Unknown Player");
                        survivorPhoto = isCurrentP1 ? regData.player2PhotoURL : regData.playerPhotoURL;
                    }
                }

                // 5. SLOT MANAGEMENT
                const wasConfirmed = regData.status === "CONFIRMED";
                let slotOpened = false;

                // If the team was confirmed, the slot ALWAYS opens up, 
                // because a "Survivor" (Single Player) does not count as a "Team".
                if (wasConfirmed) {
                    slotOpened = true;
                }

                // 6. UPDATE OLD REGISTRATION (Dissolve/Handover)
                if (survivorId) {
                    // Update the doc to belong ONLY to the survivor
                    transaction.update(regDocRef, {
                        teamId: null, // Break link to team
                        lookingForPartner: true, // Survivor needs a new partner
                        partnerStatus: "NONE", // Reset partner status

                        // SET THE SURVIVOR AS THE PRIMARY PLAYER
                        playerId: survivorId,
                        fullNameP1: survivorName, // <--- Now using the fetched name
                        playerPhotoURL: survivorPhoto,
                        isPrimary: true,

                        // REMOVE LEGACY FIELDS
                        playerDisplayName: survivorName, // Sync just in case

                        // WIPE THE SECONDARY SLOT
                        player2Id: null,
                        fullNameP2: null,
                        player2Confirmed: false,
                        player2PhotoURL: null,
                        invite: null,

                        // Status stays same (CONFIRMED) but now as Single Player
                        status: regData.status,
                        _debugSource: "useTeamDissolve Hook"
                    });
                } else {
                    // Delete dead registration if no one is left
                    transaction.delete(regDocRef);
                }

                // 7. EVENT COUNT MANAGEMENT & WAITLIST PROMOTION
                if (slotOpened) {
                    if (candidateDoc) {
                        // A. Promote the Candidate Captain
                        const candidateRef = doc(db, "registrations", candidateDoc.id);
                        const candidateData = candidateDoc.data();

                        transaction.update(candidateRef, {
                            status: "CONFIRMED",
                            waitlistPosition: null
                        });

                        // B. Decrement Waitlist Count
                        transaction.update(eventRef, {
                            waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1)
                        });

                        // C. NOTIFY THE PROMOTED TEAM (Notify Captain)
                        const p1Notif = doc(collection(db, "notifications"));
                        transaction.set(p1Notif, {
                            notificationId: p1Notif.id,
                            userId: candidateData.playerId,
                            type: "system",
                            title: "You're In!",
                            message: `A slot opened up! Your team has been promoted to CONFIRMED for ${eventData.eventName}.`,
                            eventId: eventId,
                            read: false,
                            createdAt: Timestamp.now()
                        });

                        // Notify Partner (If exists)
                        if (candidateData.player2Id) {
                            const p2Notif = doc(collection(db, "notifications"));
                            transaction.set(p2Notif, {
                                notificationId: p2Notif.id,
                                userId: candidateData.player2Id,
                                type: "system",
                                title: "You're In!",
                                message: `A slot opened up! Your team has been promoted to CONFIRMED for ${eventData.eventName}.`,
                                eventId: eventId,
                                read: false,
                                createdAt: Timestamp.now()
                            });
                        }

                    } else {
                        // No one on waitlist? Just decrement confirmed counts (Team Slot Freed)
                        transaction.update(eventRef, {
                            registrationsCount: Math.max(0, (eventData.registrationsCount || 0) - 1)
                        });
                    }
                } else if (!survivorId && !wasConfirmed) {
                    // An unconfirmed team dissolved.
                    if (regData.status === 'WAITLIST') {
                        transaction.update(eventRef, {
                            waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1)
                        });
                    }
                }

                // 8. Cleanup
                transaction.delete(teamRef);
                if (notificationId) {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                }

                // 9. Notify Survivor
                if (survivorId) {
                    const replyNotifRef = doc(collection(db, "notifications"));
                    const title = actionType === "DECLINE" ? "Invitation Declined" : "Partner Withdrew";
                    const msg = actionType === "DECLINE"
                        ? `${currentUser.displayName || "Partner"} declined your invite.`
                        : `${currentUser.displayName || "Partner"} left the team.`;

                    transaction.set(replyNotifRef, {
                        notificationId: replyNotifRef.id,
                        userId: survivorId,
                        type: actionType === "DECLINE" ? "partner_declined" : "system",
                        title: title,
                        message: msg,
                        eventId: eventId,
                        read: false,
                        createdAt: Timestamp.now()
                    });
                }
            });

            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("Dissolve error:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to dissolve team.";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return { dissolveTeam, loading, error };
};