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
                where("isPrimary", "==", true), // Only look for Captains
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
                let survivorName = isCurrentP1 ? regData.fullNameP2 : regData.fullNameP1;
                // Preserve the photo of the person STAYING
                let survivorPhoto = isCurrentP1 ? (regData.player2PhotoURL || "") : regData.playerPhotoURL;

                // Edge Case: If P1 leaves and there is NO P2, slot is abandoned (No survivor).
                if (actionType === "LEAVE" && !regData.player2Id && isCurrentP1) {
                    survivorId = null;
                }

                // 4. SLOT MANAGEMENT
                const wasConfirmed = regData.status === "CONFIRMED";
                let slotOpened = false;

                if (!survivorId && wasConfirmed) {
                    slotOpened = true; // Abandoned confirmed slot
                }

                // 5. UPDATE OLD REGISTRATION (Dissolve/Handover)
                if (survivorId) {
                    // Update the doc to belong ONLY to the survivor
                    transaction.update(regDocRef, {
                        teamId: null, // Break link to team
                        lookingForPartner: true, // Survivor needs a new partner
                        partnerStatus: actionType === "DECLINE" ? "DENIED" : "NONE",

                        // SET THE SURVIVOR AS THE PRIMARY PLAYER
                        // If P2 Left: survivorId is P1. P1 stays P1.
                        // If P1 Left: survivorId is P2. P2 moves to P1 slot.
                        playerId: survivorId,
                        playerDisplayName: survivorName,
                        fullNameP1: survivorName,
                        playerPhotoURL: survivorPhoto,
                        isPrimary: true,

                        // WIPE THE SECONDARY SLOT
                        player2Id: null,
                        fullNameP2: null,
                        player2Confirmed: false,
                        player2PhotoURL: null,

                        // Status stays same (CONFIRMED or WAITLIST)
                        status: regData.status,
                        _debugSource: "useTeamDissolve Hook"
                    });
                } else {
                    // Delete dead registration
                    transaction.delete(regDocRef);
                }

                // 6. WAITLIST PROMOTION (If a CONFIRMED slot opened)
                if (slotOpened) {
                    if (candidateDoc) {
                        // A. Promote the Candidate Captain
                        const candidateRef = doc(db, "registrations", candidateDoc.id);
                        const candidateData = candidateDoc.data();

                        transaction.update(candidateRef, {
                            status: "CONFIRMED",
                            waitlistPosition: null // Remove from queue
                        });

                        // B. Decrement Waitlist Count (moved one from Waitlist -> Active)
                        transaction.update(eventRef, {
                            waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1)
                        });

                        // C. NOTIFY THE PROMOTED TEAM (Fix: Notify BOTH players)

                        // 1. Notify Captain
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

                        // 2. Notify Partner (If exists)
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
                        // No one on waitlist? Just decrement confirmed counts.
                        transaction.update(eventRef, {
                            registrationsCount: Math.max(0, (eventData.registrationsCount || 0) - 1)
                        });
                    }
                } else if (!survivorId && !wasConfirmed) {
                    // An unconfirmed/waitlist team dissolved. Just decrement waitlist.
                    transaction.update(eventRef, {
                        waitlistCount: Math.max(0, (eventData.waitlistCount || 0) - 1)
                    });
                }

                // 7. Cleanup
                transaction.delete(teamRef);
                if (notificationId) {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                }

                // 8. Notify Survivor (The one who was left behind)
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

        } catch (err: any) {
            console.error("Dissolve error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return { dissolveTeam, loading, error };
};