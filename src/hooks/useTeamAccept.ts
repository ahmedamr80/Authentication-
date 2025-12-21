import { useState } from "react";
import {
    doc,
    runTransaction,
    collection,
    Timestamp,
    query,
    where,
    getDocs,
    getDoc,
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
    // playerPhotoURL?: string | null;
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

            // Phase 1.0: Fetch target team to get eventId (needed to find Solo Reg)
            const targetTeamRef = doc(db, "teams", teamId);
            const targetTeamSnap = await getDocs(query(collection(db, "teams"), where("__name__", "==", teamId))); // using query to avoid reading if not exists? No, getDoc is fine but we want to fail fast if needed. Actually getDoc is better.
            const targetTeamDoc = await getDoc(targetTeamRef);

            let soloRegToDeleteId: string | null = null;
            let targetEventId: string | null = null;

            if (targetTeamDoc.exists()) {
                const data = targetTeamDoc.data();
                targetEventId = data.eventId;

                // Check for "Old Life" Solo Registration (Reg B)
                // Where I am the Primary Player (playerId == me) for this Event
                const soloRegQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", targetEventId),
                    where("playerId", "==", currentUser.uid)
                );
                const soloRegSnap = await getDocs(soloRegQuery);

                if (!soloRegSnap.empty) {
                    // We found a registration where I am Primary.
                    // Verify it's not the one linked to the team (unlikely in Scenario 11, but possible if MERGE_P1 swapped roles?)
                    // in Scenario 11: Reg A (Team) has me as P2. Reg B (Solo) has me as P1.
                    // So if I find a Reg where I am P1, it's likely the Solo one I want to nuke.
                    const soloDoc = soloRegSnap.docs[0];
                    if (soloDoc.data().teamId !== teamId) {
                        soloRegToDeleteId = soloDoc.id;
                        console.log("   🎯 Found Solo Registration to Cleanup:", soloRegToDeleteId);
                    }
                }
            }

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
                            // playerPhotoURL: regData.playerPhotoURL,
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

                let regQuery = query(collection(db, "registrations"), where("teamId", "==", teamId));
                let regSnap = await getDocs(regQuery);

                // Fallback: If not found by teamId (e.g. Free Agent with multiple invites), find by User ID + Event
                if (regSnap.empty) {
                    // Logic: If I am P1 in the team, check if I have a registration as P1 for this event
                    if (isP1) {
                        // Note: We need eventId from teamData, which is fetched below. 
                        // But we can't query without eventId efficiently/safely if index missing?
                        // Ideally we get eventId first. Let's reorder.
                    }
                }

                // REORDERED LOGIC START
                const eventRef = doc(db, "events", teamData.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("No event.");
                const eventData = eventDoc.data();

                if (regSnap.empty) {
                    regQuery = query(collection(db, "registrations"),
                        where("eventId", "==", teamData.eventId),
                        where("playerId", "==", currentUser.uid),
                        where("status", "in", ["CONFIRMED", "WAITLIST"]) // Only valid regs
                    );
                    regSnap = await getDocs(regQuery);

                    // Also check if I am P2 in a registration? (Less likely for Accept, usually I am accepting AS P2, or AS P1 (Free Agent))
                    // If I am Free Agent (MERGE_P1), I am P1 in the Team, and P1 in my Registration.
                    // Logic holds.
                }

                if (regSnap.empty) throw new Error("No registration found for user.");
                const regRef = doc(db, "registrations", regSnap.docs[0].id);
                // REORDERED LOGIC END

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

                if (soloRegToDeleteId) {
                    transaction.delete(doc(db, "registrations", soloRegToDeleteId));
                }

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
                        player2Id: null, fullNameP2: null, player2Confirmed: false, //player2PhotoURL: null, 
                        invite: null,
                        _debugSource: "useTeamAccept Hook - Orphan Cleanup", _lastUpdated: serverTimestamp()
                        //  fullNameP1: reg.fullNameP1 ?? null, playerPhotoURL: reg.playerPhotoURL ?? null, status: reg.status ?? STATUS.PENDING,
                    });
                }

                if (notificationId && notificationId !== 'from_url') {
                    transaction.update(doc(db, "notifications", notificationId), { read: true });
                }

                const otherUserId = isP1 ? teamData.player2Id : teamData.player1Id;
                if (otherUserId) {
                    const eventDateFormatted = eventData.dateTime?.toDate().toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit'
                    }).replace(/\//g, '-') || 'dd-mm-yy';

                    const replyRef = doc(collection(db, "notifications"));
                    transaction.set(replyRef, {
                        notificationId: replyRef.id,
                        userId: otherUserId,
                        type: NOTIFICATION_TYPE.PARTNER_ACCEPTED,
                        title: "Team Confirmed!",
                        message: `${accepterName} has accepted your invitation for ${eventData.eventName} on ${eventDateFormatted}, you now a team`,
                        fromUserId: currentUser.uid,
                        eventId: teamData.eventId,
                        teamId: teamId,
                        read: false,
                        createdAt: serverTimestamp()
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