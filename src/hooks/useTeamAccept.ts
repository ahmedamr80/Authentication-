import { useState } from "react";
import {
    doc,
    runTransaction,
    collection,
    Timestamp,
    query,
    where,
    getDocs,
    serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { User } from "firebase/auth";
import { fetchPlayerName } from "@/lib/utils";

// Constants
const STATUS = {
    CONFIRMED: "CONFIRMED",
    WAITLIST: "WAITLIST",
    PENDING: "PENDING",
} as const;

const NOTIFICATION_TYPE = {
    SYSTEM: "system",
    PARTNER_ACCEPTED: "partner_accepted",
    PARTNER_JOINED_OTHER: "partner_joined_other"
} as const;

interface OrphanTeamData {
    teamId: string;
    player1Id: string;
    eventId: string;
    player1Name?: string;
}

interface OrphanRegData {
    regId: string;
    playerId: string;
    fullNameP1?: string;
    playerPhotoURL?: string | null;
    status: string;
}

export const useTeamAccept = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const acceptInvite = async (
        currentUser: User,
        teamId: string,
        notificationId?: string,
        onSuccess?: () => void
    ) => {
        setLoading(true);
        setError(null);

        try {
            console.log("🚀 Starting Team Accept Process");
            const accepterName = await fetchPlayerName(currentUser.uid, currentUser.displayName);

            // Phase 1: Pre-fetch Orphan Teams
            const otherPendingTeamsQuery = query(
                collection(db, "teams"),
                where("player2Id", "==", currentUser.uid),
                where("status", "==", STATUS.PENDING)
            );
            const otherPendingSnap = await getDocs(otherPendingTeamsQuery);
            const teamsToCleanup: OrphanTeamData[] = [];
            const orphanRegData: OrphanRegData[] = [];

            for (const teamDoc of otherPendingSnap.docs) {
                if (teamDoc.id !== teamId) {
                    const data = teamDoc.data();
                    teamsToCleanup.push({
                        teamId: teamDoc.id,
                        player1Id: data.player1Id,
                        eventId: data.eventId,
                        player1Name: data.fullNameP1 || data.player1?.displayName
                    });

                    const regQuery = query(collection(db, "registrations"), where("teamId", "==", teamDoc.id));
                    const regSnap = await getDocs(regQuery);
                    if (!regSnap.empty) {
                        const regData = regSnap.docs[0].data();
                        orphanRegData.push({
                            regId: regSnap.docs[0].id,
                            playerId: regData.playerId,
                            fullNameP1: regData.fullNameP1,
                            playerPhotoURL: regData.playerPhotoURL,
                            status: regData.status
                        });
                    }
                }
            }

            // Phase 2: Transaction
            await runTransaction(db, async (transaction) => {
                const teamRef = doc(db, "teams", teamId);
                const teamDoc = await transaction.get(teamRef);
                if (!teamDoc.exists()) throw new Error("Team not found.");
                const teamData = teamDoc.data();

                const isP1 = teamData.player1Id === currentUser.uid;
                const isP2 = teamData.player2Id === currentUser.uid;
                if (!isP1 && !isP2) throw new Error("Not a member.");

                const regQuery = query(collection(db, "registrations"), where("teamId", "==", teamId));
                const regSnap = await getDocs(regQuery);
                if (regSnap.empty) throw new Error("No reg.");
                const regRef = doc(db, "registrations", regSnap.docs[0].id);

                const eventRef = doc(db, "events", teamData.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("No event.");
                const eventData = eventDoc.data();

                const currentCount = eventData.registrationsCount || 0;
                const slotsAvailable = eventData.slotsAvailable || 0;
                const isFull = currentCount >= slotsAvailable;
                let finalStatus: "CONFIRMED" | "WAITLIST" = isFull ? STATUS.WAITLIST : STATUS.CONFIRMED;

                if (isFull) {
                    transaction.update(eventRef, { waitlistCount: (eventData.waitlistCount || 0) + 1 });
                } else {
                    transaction.update(eventRef, { registrationsCount: currentCount + 1 });
                }

                // Update accepted team
                const teamUpdates: Record<string, any> = { status: finalStatus };
                const regUpdate: Record<string, any> = {
                    status: finalStatus,
                    partnerStatus: "CONFIRMED",
                    waitlistPosition: finalStatus === STATUS.WAITLIST ? (eventData.waitlistCount || 0) + 1 : 0,
                    lookingForPartner: false,
                    confirmedAt: Timestamp.now()
                };

                if (isP1) {
                    teamUpdates.player1Confirmed = true; teamUpdates.fullNameP1 = accepterName;
                    regUpdate.fullNameP1 = accepterName; regUpdate.playerPhotoURL = currentUser.photoURL || null;
                } else {
                    teamUpdates.player2Confirmed = true; teamUpdates.fullNameP2 = accepterName;
                    regUpdate.fullNameP2 = accepterName; regUpdate.player2PhotoURL = currentUser.photoURL || null;
                }

                transaction.update(teamRef, teamUpdates);
                transaction.update(regRef, regUpdate);

                // Cleanup Orphans
                for (const team of teamsToCleanup) {
                    transaction.delete(doc(db, "teams", team.teamId));
                    const notifRef = doc(collection(db, "notifications"));
                    transaction.set(notifRef, {
                        notificationId: notifRef.id, userId: team.player1Id, type: NOTIFICATION_TYPE.PARTNER_JOINED_OTHER,
                        title: "Partner Unavailable", message: `${accepterName} joined another team.`,
                        eventId: team.eventId, read: false, createdAt: serverTimestamp()
                    });
                }

                for (const reg of orphanRegData) {
                    transaction.update(doc(db, "registrations", reg.regId), {
                        teamId: null, lookingForPartner: true, partnerStatus: "NONE",
                        player2Id: null, fullNameP2: null, player2Confirmed: false, player2PhotoURL: null, invite: null,
                        fullNameP1: reg.fullNameP1 ?? null, playerPhotoURL: reg.playerPhotoURL ?? null, status: reg.status ?? STATUS.PENDING,
                        _lastUpdated: serverTimestamp()
                    });
                }

                if (notificationId && notificationId !== 'from_url') {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                }

                const otherUserId = isP1 ? teamData.player2Id : teamData.player1Id;
                if (otherUserId) {
                    const replyRef = doc(collection(db, "notifications"));
                    transaction.set(replyRef, {
                        notificationId: replyRef.id, userId: otherUserId, type: NOTIFICATION_TYPE.PARTNER_ACCEPTED,
                        title: "Team Confirmed!", message: `${accepterName} accepted your invite.`,
                        fromUserId: currentUser.uid, eventId: teamData.eventId, teamId: teamId, read: false, createdAt: serverTimestamp()
                    });
                }
            });

            if (onSuccess) onSuccess();
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return { acceptInvite, loading, error };
};