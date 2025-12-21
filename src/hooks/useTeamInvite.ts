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
import { fetchPlayerName } from "@/lib/utils"; // <--- NEW: Import the helper

// Define generic types for flexibility
export interface InviteEventData {
    eventId: string;
    eventName: string;
    dateTime: Timestamp;
    registrationsCount?: number;
    waitlistCount?: number;
    slotsAvailable?: number;
}

export interface InvitePartnerData {
    uid: string;           // Required: The unique ID of the user (from Firebase Auth)
    playerId?: string;     // Optional: An alternative ID, perhaps from a specific player profile
    displayName: string;   // Required: The display name of the partner
    photoURL?: string;     // Optional: The URL to the partner's profile photo
    email?: string;        // Optional: The email address of the partner
}

export const useTeamInvite = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sendInvite = async (
        currentUser: User,
        event: InviteEventData,
        partner: InvitePartnerData,
        onSuccess?: () => void,
        senderProfileOverride?: { displayName?: string, photoURL?: string }
    ) => {
        // 1. Basic Sanity Checks
        if (!currentUser || !event || !partner) {
            console.error("Missing required arguments for sendInvite");
            return false;
        }

        setLoading(true);
        setError(null);

        // <--- NEW: Fetch the real sender name using the helper
        // We await this so we have the correct name before starting the logic.
        // We pass 'senderProfileOverride?.displayName' as the first fallback, 
        // and 'currentUser.displayName' as the second fallback.
        const senderName = await fetchPlayerName(
            currentUser.uid,
            senderProfileOverride?.displayName || currentUser.displayName
        );
        // <--- END NEW

        try {
            // ---------------------------------------------------------
            // 2. THE "MEMBER CHECK"
            // ---------------------------------------------------------
            const player1Id = currentUser.uid;
            const player2Id = partner.uid || partner.playerId;

            if (!player2Id) {
                throw new Error("Invalid partner data: Missing user ID");
            }

            const isPlayer1 = player1Id === currentUser.uid;
            if (!isPlayer1) {
                throw new Error("Security Error: You cannot create a team where you are not the primary player.");
            }

            if (player1Id === player2Id) {
                throw new Error("You cannot invite yourself.");
            }

            // ---------------------------------------------------------
            // 3. THE "AVAILABILITY CHECK"
            // ---------------------------------------------------------
            const registrationsRef = collection(db, "registrations");

            // Check A: Am I the "Main Player" in any registration?
            const primaryCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("playerId", "==", currentUser.uid),
                where("status", "!=", "CANCELLED")
            );

            // Check B: Am I the "Secondary Player" in someone else's registration?
            const secondaryCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", currentUser.uid),
                where("status", "!=", "CANCELLED")
            );

            // Execute sender checks
            const [primarySnap, secondarySnap] = await Promise.all([
                getDocs(primaryCheck),
                getDocs(secondaryCheck)
            ]);

            // RELAXED CHECK: If I am already registered, check if I am "Looking".
            let myExistingRegId: string | null = null;
            let amILooking = false;

            if (!primarySnap.empty) {
                const myReg = primarySnap.docs[0];
                const myData = myReg.data();
                if (myData.lookingForPartner === true) {
                    amILooking = true;
                    myExistingRegId = myReg.id;
                } else {
                    throw new Error("You are already in a confirmed team.");
                }
            } else if (!secondarySnap.empty) {
                throw new Error("You are already in a confirmed team.");
            }

            // Check C: is the partner the "Invited Player" (P1) in any confirmed registration?
            const thirdCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("playerId", "==", partner.uid),
                where("status", "==", "CONFIRMED")
            );

            // Check D: is the partner the "Secondary Player" (P2) in any confirmed registration?
            const fourthCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", partner.uid),
                where("status", "==", "CONFIRMED")
            );

            // Execute partner checks
            const [thirdSnap, fourthSnap] = await Promise.all([
                getDocs(thirdCheck),
                getDocs(fourthCheck)
            ]);

            // Check E: Is the partner a "Pending P2" (Received invite but hasn't accepted, and looking)?
            // (Note: This is mostly for 'Orphan in Position 2' logic)
            const fifthCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", partner.uid),
                where("lookingForPartner", "==", true)
            );

            const [fifthSnap] = await Promise.all([
                getDocs(fifthCheck)
            ]);

            // ---------------------------------------------------------
            // 4. DETERMINE INVITE MODE & VALIDATE PARTNER
            // ---------------------------------------------------------
            let inviteMode: "FRESH" | "MERGE_P1" | "MERGE_P2" | "FILL_P2" = "FRESH";
            let targetRegId: string | null = null;

            // Priority 0: I am trying to fill my own spot
            if (amILooking && myExistingRegId) {
                inviteMode = "FILL_P2";
                targetRegId = myExistingRegId;
            }

            // Priority 1: Partner is Confirmed P2 -> They are BUSY (Already in a team)
            if (!fourthSnap.empty) {
                throw new Error("Your partner is already registered in a team.");
            }

            // Priority 2: Partner is Confirmed P1 -> Are they looking?
            if (!thirdSnap.empty) {
                const doc = thirdSnap.docs[0];
                const data = doc.data();

                if (data.lookingForPartner === true) {
                    // They are a Free Agent! We can merge.
                    inviteMode = "MERGE_P1";
                    targetRegId = doc.id;
                } else {
                    // They are Confirmed and NOT looking. They are BUSY.
                    throw new Error("Your partner is already registered and not looking for a teammate.");
                }
            }
            // Priority 3: Partner is Pending P2 (Orphan P2) -> Are they looking?
            else if (!fifthSnap.empty) {
                const doc = fifthSnap.docs[0];
                inviteMode = "MERGE_P2";
                targetRegId = doc.id;
            }
            // If none of the above, it's a FRESH invite (Scenario 1)

            // ---------------------------------------------------------
            // 5. THE TRANSACTION
            // ---------------------------------------------------------
            await runTransaction(db, async (transaction) => {
                // A. Common Setup
                const teamRef = doc(collection(db, "teams"));
                const teamId = teamRef.id;

                // B. Event Check
                if (inviteMode === "FRESH") {
                    const eventRef = doc(db, "events", event.eventId);
                    const eventDoc = await transaction.get(eventRef);
                    if (!eventDoc.exists()) throw new Error("Event not found");
                }

                // C. Prepare Data
                let p1Id, p2Id, p1Name, p2Name, p1Confirmed, p2Confirmed, inviteType;
                // We need to know WHO gets the notification
                let targetUserId;

                if (inviteMode === "FILL_P2") {
                    p1Id = currentUser.uid;
                    p2Id = partner.uid;
                    p1Name = senderName; // <--- Uses fetched name
                    p2Name = partner.displayName;
                    p1Confirmed = true;  // I am confirmed (Inviter)
                    p2Confirmed = false; // Partner needs to accept (Target)
                    inviteType = "FILL_P2";
                    targetUserId = p2Id; // Notification goes to P2
                } else if (inviteMode === "MERGE_P1") {
                    p1Id = partner.uid;
                    p2Id = currentUser.uid;
                    p1Name = partner.displayName;
                    p2Name = senderName; // <--- Uses fetched name
                    p1Confirmed = false; // P1 must accept the request (Target)
                    p2Confirmed = true;  // You initiated it (Initiator)
                    inviteType = "MERGE_P1";
                    targetUserId = p1Id; // Notification goes to P1
                } else if (inviteMode === "MERGE_P2") {
                    p1Id = currentUser.uid;
                    p2Id = partner.uid;
                    p1Name = senderName; // <--- Uses fetched name
                    p2Name = partner.displayName;
                    p1Confirmed = true;  // You initiated it (Initiator)
                    p2Confirmed = false; // P2 must accept (Target)
                    inviteType = "MERGE_P2";
                    targetUserId = p2Id; // Notification goes to P2 
                } else {
                    p1Id = currentUser.uid;
                    p2Id = partner.uid;
                    p1Name = senderName; // <--- Uses fetched name
                    p2Name = partner.displayName;
                    p1Confirmed = true;
                    p2Confirmed = false; // Target
                    inviteType = "FRESH";
                    targetUserId = p2Id;
                }

                // Create Team
                transaction.set(teamRef, {
                    teamId: teamId,
                    eventId: event.eventId,
                    player1Id: p1Id,
                    player2Id: p2Id,
                    fullNameP1: p1Name,
                    fullNameP2: p2Name,
                    player1Confirmed: p1Confirmed,
                    player2Confirmed: p2Confirmed,
                    status: "PENDING",
                    createdAt: Timestamp.now(),
                    invite: inviteType,
                    _debugSource: "useTeamInvite Hook"
                });

                // Update Registration
                if (inviteMode === "FRESH") {
                    const regRef = doc(collection(db, "registrations"));
                    transaction.set(regRef, {
                        registrationId: regRef.id,
                        eventId: event.eventId,
                        playerId: currentUser.uid,
                        player2Id: partner.uid,
                        fullNameP1: p1Name, // The fetched sender name
                        fullNameP2: p2Name, // The partner name
                        teamId: teamId,
                        status: "PENDING",
                        partnerStatus: "PENDING",
                        isPrimary: true,
                        invite: inviteType,
                        lookingForPartner: false,
                        _debugSource: "useTeamInvite Hook",
                        registeredAt: Timestamp.now()
                    });
                } else if (inviteMode === "FILL_P2") {
                    if (!targetRegId) throw new Error("Missing target registration for FILL_P2");
                    const regRef = doc(db, "registrations", targetRegId);
                    transaction.update(regRef, {
                        player2Id: partner.uid,
                        fullNameP2: partner.displayName,
                        partnerStatus: "PENDING",
                        lookingForPartner: false, // Stop looking, I found someone pending
                        teamId: teamId,
                        _debugSource: "useTeamInvite Hook",
                        invite: inviteType,
                    });
                } else if (inviteMode === "MERGE_P1") {
                    // MULTIPLE INVITES LOGIC:
                    // We do NOT update the Free Agent's registration here.
                    // This allows them to receive multiple invites (multiple Pending Teams).
                    // Their registration remains "Looking for Partner" until they ACCEPT one.
                    // useTeamAccept will handle linking the registration to the Accepted Team.
                } else if (inviteMode === "MERGE_P2") {
                    if (!targetRegId) throw new Error("Missing target registration");
                    const regRef = doc(db, "registrations", targetRegId);
                    transaction.update(regRef, {
                        playerId: currentUser.uid,
                        fullNameP1: senderName, // <--- Uses fetched name
                        isPrimary: true,
                        partnerStatus: "PENDING",
                        teamId: teamId,
                        invite: inviteType,
                        _debugSource: "useTeamInvite Hook",
                        lookingForPartner: false
                    });
                }

                // E. Create Notification (Use targetUserId)
                const eventDateFormatted = event.dateTime.toDate().toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit'
                }).replace(/\//g, '-');

                const notifRef = doc(collection(db, "notifications"));
                transaction.set(notifRef, {
                    notificationId: notifRef.id,
                    userId: targetUserId, // Send to the correct target
                    type: "partner_invite",
                    title: "Team Request",
                    message: `${senderName} has invited you to ${event.eventName} on ${eventDateFormatted}`,
                    fromUserId: currentUser.uid,
                    eventId: event.eventId,
                    eventName: event.eventName,
                    eventDate: event.dateTime,
                    teamId: teamId,
                    read: false,
                    createdAt: Timestamp.now(),
                    invite: inviteType,
                    _debugSource: "useTeamInvite Hook"
                });
            });

            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error(err);
            const errorMessage = err instanceof Error ? err.message : "Failed to send invite.";
            setError(errorMessage);
            // We throw here so the UI can catch it and display the toast
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return { sendInvite, loading, error };
};