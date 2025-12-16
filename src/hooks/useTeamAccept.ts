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
            console.log("   - Team ID:", teamId);
            console.log("   - User:", currentUser.displayName || currentUser.uid);

            // Pre-fetch the real name before starting the transaction
            const accepterName = await fetchPlayerName(currentUser.uid, currentUser.displayName);
            console.log("   - Accepter Name:", accepterName);

            // -------------------------------------------------------
            // PHASE 1: PRE-FETCHING (User B's Other Pending Teams)
            // -------------------------------------------------------
            console.log("\n📥 PHASE 1: Pre-fetching User B's other pending teams...");

            // Find all pending teams where User B is player2 (invited party)
            const otherPendingTeamsQuery = query(
                collection(db, "teams"),
                where("player2Id", "==", currentUser.uid),
                where("status", "==", STATUS.PENDING)
            );
            const otherPendingSnap = await getDocs(otherPendingTeamsQuery);

            // Filter out the team being accepted
            const teamsToCleanup: OrphanTeamData[] = [];
            const regIdsToCleanup: string[] = [];

            for (const teamDoc of otherPendingSnap.docs) {
                if (teamDoc.id !== teamId) {
                    const data = teamDoc.data();
                    teamsToCleanup.push({
                        teamId: teamDoc.id,
                        player1Id: data.player1Id,
                        eventId: data.eventId,
                        player1Name: data.fullNameP1 || data.player1?.displayName
                    });
                    console.log("   📌 Found orphan team:", teamDoc.id, "Captain:", data.player1Id);
                }
            }

            // Find registrations for those orphan teams
            const orphanRegData: OrphanRegData[] = [];
            for (const orphanTeam of teamsToCleanup) {
                const regQuery = query(
                    collection(db, "registrations"),
                    where("teamId", "==", orphanTeam.teamId)
                );
                const regSnap = await getDocs(regQuery);
                if (!regSnap.empty) {
                    const regDoc = regSnap.docs[0];
                    const regData = regDoc.data();
                    orphanRegData.push({
                        regId: regDoc.id,
                        playerId: regData.playerId,
                        fullNameP1: regData.fullNameP1,
                        playerPhotoURL: regData.playerPhotoURL,
                        status: regData.status
                    });
                    regIdsToCleanup.push(regDoc.id);
                    console.log("   📌 Found orphan registration:", regDoc.id);
                }
            }

            console.log(`   ✅ Found ${teamsToCleanup.length} orphan team(s) to cleanup`);

            // -------------------------------------------------------
            // PHASE 2: ATOMIC TRANSACTION
            // -------------------------------------------------------
            console.log("\n⚡ PHASE 2: Starting atomic transaction...");

            await runTransaction(db, async (transaction) => {
                // A. Read the Team being accepted
                const teamRef = doc(db, "teams", teamId);
                const teamDoc = await transaction.get(teamRef);
                if (!teamDoc.exists()) throw new Error("Team not found or invite expired.");

                const teamData = teamDoc.data();

                // B. Security Check & Role Identification
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
                if (teamData.status === STATUS.CONFIRMED) {
                    throw new Error("This team is already confirmed.");
                }

                // C. Find the Registration (The "Seat") for accepted team
                const regsRef = collection(db, "registrations");
                const q = query(regsRef, where("teamId", "==", teamId));
                const regSnap = await getDocs(q);

                if (regSnap.empty) throw new Error("Registration seat not found.");
                const regDoc = regSnap.docs[0];
                const regRef = doc(db, "registrations", regDoc.id);

                // D. OPTIMISTIC READS: Read all orphan teams and registrations
                const orphanTeamRefs: { ref: ReturnType<typeof doc>, data: OrphanTeamData }[] = [];
                const orphanRegRefs: { ref: ReturnType<typeof doc>, data: OrphanRegData }[] = [];

                for (let i = 0; i < teamsToCleanup.length; i++) {
                    const orphanTeam = teamsToCleanup[i];
                    const orphanTeamRef = doc(db, "teams", orphanTeam.teamId);
                    const orphanTeamSnap = await transaction.get(orphanTeamRef);
                    if (orphanTeamSnap.exists()) {
                        orphanTeamRefs.push({ ref: orphanTeamRef, data: orphanTeam });
                    }
                }

                for (let i = 0; i < orphanRegData.length; i++) {
                    const orphanReg = orphanRegData[i];
                    const orphanRegRef = doc(db, "registrations", orphanReg.regId);
                    const orphanRegSnap = await transaction.get(orphanRegRef);
                    if (orphanRegSnap.exists()) {
                        orphanRegRefs.push({ ref: orphanRegRef, data: orphanReg });
                    }
                }

                // E. CAPACITY CHECK & EVENT UPDATE
                const eventRef = doc(db, "events", teamData.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("Event not found.");
                const eventData = eventDoc.data();

                const currentCount = eventData.registrationsCount || 0;
                const slotsAvailable = eventData.slotsAvailable || 0;
                const isFull = currentCount >= slotsAvailable;

                let finalStatus: "CONFIRMED" | "WAITLIST" = STATUS.CONFIRMED;

                console.log("\n📊 Capacity Check:");
                console.log("   - Current Count:", currentCount);
                console.log("   - Slots Available:", slotsAvailable);
                console.log("   - Is Full?", isFull);

                if (isFull) {
                    finalStatus = STATUS.WAITLIST;
                    transaction.update(eventRef, {
                        waitlistCount: (eventData.waitlistCount || 0) + 1
                    });
                    console.log("   → Status: WAITLIST");
                } else {
                    finalStatus = STATUS.CONFIRMED;
                    transaction.update(eventRef, {
                        registrationsCount: currentCount + 1
                    });
                    console.log("   → Status: CONFIRMED");
                }

                // -------------------------------------------------------
                // TRANSACTION WRITES
                // -------------------------------------------------------
                console.log("\n🔧 Writing changes...");

                // 1. Update Team Status
                const teamUpdates: Record<string, unknown> = {
                    status: finalStatus
                };

                if (isP1) {
                    teamUpdates.player1Confirmed = true;
                    teamUpdates.fullNameP1 = accepterName;
                } else {
                    teamUpdates.player2Confirmed = true;
                    teamUpdates.fullNameP2 = accepterName;
                }

                transaction.update(teamRef, teamUpdates);
                console.log("   ✅ Team updated:", teamId);

                // 2. Update Registration Status
                const regUpdate: Record<string, unknown> = {
                    status: finalStatus,
                    partnerStatus: "CONFIRMED",
                    waitlistPosition: finalStatus === STATUS.WAITLIST ? (eventData.waitlistCount || 0) + 1 : 0,
                    lookingForPartner: false,
                    _debugSource: "useTeamAccept Hook",
                    confirmedAt: Timestamp.now()
                };

                if (isP1) {
                    regUpdate.fullNameP1 = accepterName;
                    regUpdate.playerPhotoURL = currentUser.photoURL || null;
                } else {
                    regUpdate.fullNameP2 = accepterName;
                    regUpdate.player2PhotoURL = currentUser.photoURL || null;
                }

                transaction.update(regRef, regUpdate);
                console.log("   ✅ Registration updated:", regDoc.id);

                // 3. CLEANUP: Delete orphan teams and restore Captains
                console.log("\n🧹 Cleanup Phase: Processing orphan teams...");

                for (const { ref: orphanTeamRef, data: orphanTeam } of orphanTeamRefs) {
                    // Delete the orphan team
                    transaction.delete(orphanTeamRef);
                    console.log("   🗑️ Deleted orphan team:", orphanTeam.teamId);

                    // Notify the Captain that their partner joined another team
                    const notifRef = doc(collection(db, "notifications"));
                    transaction.set(notifRef, {
                        notificationId: notifRef.id,
                        userId: orphanTeam.player1Id,
                        type: NOTIFICATION_TYPE.PARTNER_JOINED_OTHER,
                        title: "Partner Unavailable",
                        message: `${accepterName} joined another team for this event. You're back to looking for a partner.`,
                        eventId: orphanTeam.eventId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                    console.log("   📧 Notified Captain:", orphanTeam.player1Id);
                }

                // 4. Restore orphan registrations (Captain becomes free agent again)
                for (const { ref: orphanRegRef, data: orphanReg } of orphanRegRefs) {
                    transaction.update(orphanRegRef, {
                        // Captain stays in P1 slot
                        playerId: orphanReg.playerId,
                        fullNameP1: orphanReg.fullNameP1 ?? null,
                        playerPhotoURL: orphanReg.playerPhotoURL ?? null,
                        isPrimary: true,

                        // Reset team status
                        teamId: null,
                        lookingForPartner: true,
                        partnerStatus: "NONE",
                        status: orphanReg.status ?? "PENDING", // Keep original status, default to PENDING

                        // Clear P2 slot
                        player2Id: null,
                        fullNameP2: null,
                        player2Confirmed: false,
                        player2PhotoURL: null,
                        invite: null,

                        _debugSource: "useTeamAccept - Orphan Cleanup",
                        _lastUpdated: serverTimestamp()
                    });
                    console.log("   ✅ Restored Captain to free agent:", orphanReg.playerId);
                }

                // 5. Handle Notifications

                // A. Mark the "Invite" notification as read
                if (notificationId && notificationId !== 'from_url') {
                    const notifRef = doc(db, "notifications", notificationId);
                    transaction.update(notifRef, { read: true });
                    console.log("   ✅ Invite notification marked as read");
                }

                // B. Notify the OTHER player (Target -> Initiator)
                const otherUserId = isP1 ? teamData.player2Id : teamData.player1Id;

                if (otherUserId) {
                    const replyNotifRef = doc(collection(db, "notifications"));
                    transaction.set(replyNotifRef, {
                        notificationId: replyNotifRef.id,
                        userId: otherUserId,
                        type: NOTIFICATION_TYPE.PARTNER_ACCEPTED,
                        title: "Team Confirmed!",
                        message: `${accepterName} accepted your invite. You are ready to play!`,
                        fromUserId: currentUser.uid,
                        eventId: teamData.eventId,
                        teamId: teamId,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                    console.log("   📧 Notified partner:", otherUserId);
                }

                console.log("\n✅ Transaction completed successfully!");
            });

            console.log("\n🎉 Team Accept completed successfully!");
            console.log(`   - Cleaned up ${teamsToCleanup.length} orphan team(s)`);

            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("\n❌ Accept Error:", err);
            const errorMessage = err instanceof Error ? err.message : "Failed to accept invite.";
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return { acceptInvite, loading, error };
};