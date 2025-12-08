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

                // 2. Security Check
                if (teamData.player2Id !== currentUser.uid) {
                    throw new Error("You are not the invited partner for this team.");
                }
                if (teamData.status === 'CONFIRMED') {
                    throw new Error("This invite has already been accepted.");
                }

                // 3. Find the Registration (The "Seat")
                // We query by teamId to find the linked registration
                const regsRef = collection(db, "registrations");
                const q = query(regsRef, where("teamId", "==", teamId));
                const regSnap = await getDocs(q);

                if (regSnap.empty) throw new Error("Registration seat not found.");
                const regDoc = regSnap.docs[0];
                const regRef = doc(db, "registrations", regDoc.id);

                // 4. Update Team Status
                transaction.update(teamRef, {
                    player2Confirmed: true,
                    status: "CONFIRMED"
                });

                // 5. Update Registration Status
                // We confirm the partner status. 
                // Note: We DO NOT change the main 'status' (CONFIRMED/WAITLIST) 
                // because that was determined by the slot availability during the Invite.
                transaction.update(regRef, {
                    partnerStatus: "CONFIRMED",
                    // Ensure P2 details are up to date (in case they changed profile recently)
                    fullNameP2: currentUser.displayName,
                    player2PhotoURL: currentUser.photoURL || null,
                    _debugSource: "useTeamAccept Hook"
                });

                // 6. Handle Notifications

                // A. Mark the "Invite" notification as read
                if (notificationId && notificationId !== 'from_url') {
                    const notifRef = doc(db, "notifications", notificationId);
                    transaction.update(notifRef, { read: true });
                }

                // B. Notify the Captain (Player 1)
                const captainNotifRef = doc(collection(db, "notifications"));
                transaction.set(captainNotifRef, {
                    notificationId: captainNotifRef.id,
                    userId: teamData.player1Id,
                    type: "partner_accepted",
                    title: "Team Confirmed!",
                    message: `${currentUser.displayName || "Your partner"} accepted your invite. You are ready to play!`,
                    fromUserId: currentUser.uid,
                    eventId: teamData.eventId,
                    teamId: teamId,
                    read: false,
                    createdAt: Timestamp.now()
                });
            });

            if (onSuccess) onSuccess();

        } catch (err: any) {
            console.error("Accept Error:", err);
            setError(err.message || "Failed to accept invite.");
        } finally {
            setLoading(false);
        }
    };

    return { acceptInvite, loading, error };
};