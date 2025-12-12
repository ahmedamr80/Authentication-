import { useState } from "react";
import {
    doc,
    runTransaction,
    collection,
    Timestamp,
    query,
    where,
    getDocs
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { User } from "firebase/auth";

export const useTeamAccept = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const acceptInvite = async (
        currentUser: User,
        teamId: string,
        notificationId?: string, // Optional: to mark the invite as read
        onSuccess?: () => void
    ) => {
        setLoading(true);
        setError(null);

        try {
            await runTransaction(db, async (transaction) => {
                // 1. Get Team Data
                const teamRef = doc(db, "teams", teamId);
                const teamDoc = await transaction.get(teamRef);
                if (!teamDoc.exists()) throw new Error("Team not found or invite expired.");

                const teamData = teamDoc.data();

                // 2. Security Check & Role Identification
                const isP1 = teamData.player1Id === currentUser.uid;
                const isP2 = teamData.player2Id === currentUser.uid;

                if (!isP1 && !isP2) {
                    throw new Error("You are not a member of this team.");
                }

                // Check if THEY specifically are already confirmed
                if ((isP1 && teamData.player1Confirmed) || (isP2 && teamData.player2Confirmed)) {
                    throw new Error("You have already accepted this invite.");
                }

                // Check if the team is already fully confirmed
                if (teamData.status === 'CONFIRMED') {
                    throw new Error("This team is already confirmed.");
                }

                // 3. Find the Registration (The "Seat")
                const regsRef = collection(db, "registrations");
                const q = query(regsRef, where("teamId", "==", teamId));
                const regSnap = await getDocs(q);

                if (regSnap.empty) throw new Error("Registration seat not found.");
                const regDoc = regSnap.docs[0];
                const regRef = doc(db, "registrations", regDoc.id);

                // 4. CAPACITY CHECK & EVENT UPDATE
                const eventRef = doc(db, "events", teamData.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("Event not found.");
                const eventData = eventDoc.data();

                const currentCount = eventData.registrationsCount || 0;
                const slotsAvailable = eventData.slotsAvailable || 0;
                const isFull = currentCount >= slotsAvailable;

                let finalStatus = "CONFIRMED";

                if (isFull) {
                    finalStatus = "WAITLIST";
                    transaction.update(eventRef, {
                        waitlistCount: (eventData.waitlistCount || 0) + 1
                    });
                } else {
                    finalStatus = "CONFIRMED";
                    transaction.update(eventRef, {
                        registrationsCount: currentCount + 1
                    });
                }

                // 5. Update Team Status
                // Changed from 'any' to a Record for type safety
                const teamUpdates: Record<string, unknown> = {
                    status: "CONFIRMED"
                };

                if (isP1) {
                    teamUpdates.player1Confirmed = true;
                    teamUpdates.fullNameP1 = currentUser.displayName;
                } else {
                    teamUpdates.player2Confirmed = true;
                    teamUpdates.fullNameP2 = currentUser.displayName;
                }

                transaction.update(teamRef, teamUpdates);

                // 6. Update Registration Status (Single, consolidated update)
                // Changed from 'any' to Record for type safety
                const regUpdate: Record<string, unknown> = {
                    status: finalStatus, // WAITLIST or CONFIRMED
                    partnerStatus: "CONFIRMED",
                    waitlistPosition: finalStatus === "WAITLIST" ? (eventData.waitlistCount || 0) + 1 : 0,
                    _debugSource: "useTeamAccept Hook"
                };

                if (isP1) {
                    regUpdate.fullNameP1 = currentUser.displayName;
                    regUpdate.playerPhotoURL = currentUser.photoURL || null;
                } else {
                    regUpdate.fullNameP2 = currentUser.displayName;
                    regUpdate.player2PhotoURL = currentUser.photoURL || null;
                }

                transaction.update(regRef, regUpdate);

                // 7. Handle Notifications

                // A. Mark the "Invite" notification as read
                if (notificationId && notificationId !== 'from_url') {
                    const notifRef = doc(db, "notifications", notificationId);
                    transaction.update(notifRef, { read: true });
                }

                // B. Notify the OTHER player (Target -> Initiator)
                // If I am P1, notify P2. If I am P2, notify P1.
                const otherUserId = isP1 ? teamData.player2Id : teamData.player1Id;

                if (otherUserId) {
                    const replyNotifRef = doc(collection(db, "notifications"));
                    transaction.set(replyNotifRef, {
                        notificationId: replyNotifRef.id,
                        userId: otherUserId,
                        type: "partner_accepted",
                        title: "Team Confirmed!",
                        message: `${currentUser.displayName || "Your partner"} accepted your invite. You are ready to play!`,
                        fromUserId: currentUser.uid,
                        eventId: teamData.eventId,
                        teamId: teamId,
                        read: false,
                        createdAt: Timestamp.now()
                    });
                }
            });

            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("Accept Error:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to accept invite.";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return { acceptInvite, loading, error };
};