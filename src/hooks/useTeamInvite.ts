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

// Define generic types for flexibility
export interface InviteEventData {
    eventId: string;
    eventName: string;
    registrationsCount?: number;
    waitlistCount?: number;
    slotsAvailable?: number;
}

export interface InvitePartnerData {
    uid?: string;
    playerId?: string;
    displayName: string;
    photoURL?: string;
    email?: string;
}

export const useTeamInvite = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sendInvite = async (
        currentUser: User,
        event: InviteEventData,
        partner: InvitePartnerData,
        onSuccess?: () => void
    ) => {
        // 1. Basic Sanity Checks
        if (!currentUser || !event || !partner) {
            console.error("Missing required arguments for sendInvite");
            return false;
        }

        setLoading(true);
        setError(null);

        try {
            // ---------------------------------------------------------
            // 2. THE "MEMBER CHECK"
            // ---------------------------------------------------------
            const player1Id = currentUser.uid;
            // Handle different data shapes (uid for User/UserProfile, playerId for SinglePlayer)
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
            // 3. THE "AVAILABILITY CHECK" (Robust Version)
            // ---------------------------------------------------------
            const registrationsRef = collection(db, "registrations");

            // Check A: Am I the "Main Player" in any registration?
            // (Covers: Single player, Team Captain, or Accepted Partner who got their own doc)
            const primaryCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("playerId", "==", currentUser.uid),
                where("status", "!=", "CANCELLED")
            );

            // Check B: Am I the "Secondary Player" in someone else's registration?
            // (Covers: Pending Invites where I am listed as player2Id)
            const secondaryCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", currentUser.uid),
                where("status", "!=", "CANCELLED")
            );

            // Execute both checks in parallel
            const [primarySnap, secondarySnap] = await Promise.all([
                getDocs(primaryCheck),
                getDocs(secondaryCheck)
            ]);

            // If EITHER returns a document, the user is already booked/busy.
            if (!primarySnap.empty || !secondarySnap.empty) {
                throw new Error("You are already registered or have a pending invite for this event.");
            }
            // Check C: is the partner the "Invited Player" in any confirmed registration?
            // (Covers: Single player, Team Captain, or Accepted Partner who got their own doc)
            const thirdCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("playerId", "==", partner.uid),
                where("status", "==", "CONFIRMED")
            );

            // Check D: is the partner the "Secondary Player" in someone else's registration?
            // (Covers: Confirmed Invites where he/she is listed as player2Id)
            const fourthCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", partner.uid),
                where("status", "==", "CONFIRMED")
            );

            // Execute both checks in parallel
            const [thirdSnap, fourthSnap] = await Promise.all([
                getDocs(thirdCheck),
                getDocs(fourthCheck)
            ]);

            // If EITHER returns a document, the user is already booked/busy.
            if (!thirdSnap.empty || !fourthSnap.empty) {
                throw new Error("Your partner is already registered in this event.");
            }

            // Check E: is the partner is free agent?
            const fifthCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", partner.uid),
                where("lookingForPartner", "==", true)
            );

            // Execute check
            const [fifthSnap] = await Promise.all([
                getDocs(fifthCheck)
            ]);

            const isPartnerConfirmedP1 = !fifthSnap.empty;
            const isPartnerConfirmedP2 = !fifthSnap.empty;

            // ---------------------------------------------------------
            // 4. DETERMINE INVITE MODE
            // ---------------------------------------------------------
            let inviteMode: "FRESH" | "MERGE_P1" | "MERGE_P2" = "FRESH";
            let targetRegId: string | null = null;
            let targetRegData: any = null;

            // Scenario 2: Partner is an Orphan in Position 1 (PlayerId)
            // We look at fifthSnap (Confirmed P1). If they are looking for partner, we allow it.
            if (isPartnerConfirmedP1) {
                const doc = fifthSnap.docs[0];
                const data = doc.data();
                if (data.lookingForPartner === true) {
                    inviteMode = "MERGE_P1";
                    targetRegId = doc.id;
                    targetRegData = data;
                } else {
                    throw new Error("Your partner is already registered and not looking for a teammate.");
                }
            }
            // Scenario 3: Partner is an Orphan in Position 2 (Player2Id)
            else if (!fifthSnap.empty) {
                // This covers the specific case where they are P2 and looking for partner
                const doc = fifthSnap.docs[0];
                inviteMode = "MERGE_P2";
                targetRegId = doc.id;
                targetRegData = doc.data();
            }
            // Block if they are Confirmed P2 (Check D)
            else if (isPartnerConfirmedP2) {
                throw new Error("Your partner is already registered in this event.");
            }
            // If they are Pending P2 (Check E) but not looking for partner, 
            // we treat it as FRESH (Poaching), so we leave inviteMode as "FRESH".
            // ---------------------------------------------------------
            // 5. THE TRANSACTION (Atomic Reservation)
            // ---------------------------------------------------------
            await runTransaction(db, async (transaction) => {
                // A. Common Setup: Create Team ID
                const teamRef = doc(collection(db, "teams"));
                const teamId = teamRef.id;

                // B. Handle Event Counters (Only for FRESH invites)
                if (inviteMode === "FRESH") {
                    const eventRef = doc(db, "events", event.eventId);
                    const eventDoc = await transaction.get(eventRef);
                    if (!eventDoc.exists()) throw new Error("Event not found");

                    const eventData = eventDoc.data();
                    const currentRegistrations = eventData.registrationsCount || 0;
                    const currentWaitlist = eventData.waitlistCount || 0;
                    const slotsAvailable = eventData.slotsAvailable || 0;

                    if (currentRegistrations >= slotsAvailable) {
                        transaction.update(eventRef, { waitlistCount: (eventData.waitlistCount || 0) + 1 });
                    } else {
                        transaction.update(eventRef, { registrationsCount: currentRegistrations + 1 });
                    }
                }

                // C. Create Team Document (Common for all)
                // We map P1/P2 based on the scenario
                let p1Id, p2Id, p1Name, p2Name, p1Confirmed, p2Confirmed, invite;

                if (inviteMode === "MERGE_P1") {
                    // Scenario: Partner is P1, You join as P2
                    p1Id = partner.uid; // Existing Orphan
                    p2Id = currentUser.uid; // You
                    p1Name = partner.displayName;
                    p2Name = currentUser.displayName;
                    p1Confirmed = true; // They are owner
                    p2Confirmed = true; // You are joining
                    invite = "MERGE_P1";

                } else if (inviteMode === "MERGE_P2") {
                    // Scenario: Partner is P2, You join as P1
                    p1Id = currentUser.uid; // You take P1 slot
                    p2Id = partner.uid; // They stay P2
                    p1Name = currentUser.displayName;
                    p2Name = partner.displayName;
                    p1Confirmed = true; // You
                    p2Confirmed = true; // They (technically pending your logic below, but team structure usually implies true if merged)
                    invite = "MERGE_P2";
                } else {
                    // FRESH
                    p1Id = currentUser.uid;
                    p2Id = partner.uid;
                    p1Name = currentUser.displayName;
                    p2Name = partner.displayName;
                    p1Confirmed = true;
                    p2Confirmed = false;
                    invite = "FRESH";
                }

                transaction.set(teamRef, {
                    teamId: teamId,
                    eventId: event.eventId,
                    player1Id: p1Id,
                    player2Id: p2Id,
                    fullNameP1: p1Name,
                    fullNameP2: p2Name,
                    player1Confirmed: p1Confirmed,
                    player2Confirmed: p2Confirmed,
                    status: "PENDING", // Team is pending until Partner accepts the "Merge" invite
                    createdAt: Timestamp.now(),
                    invite: invite, // For debugging    
                    _debugSource: "useTeamInvite Hook"

                });


                // D. Update or Create Registration
                if (inviteMode === "FRESH") {
                    const regRef = doc(collection(db, "registrations"));
                    transaction.set(regRef, {
                        registrationId: regRef.id,
                        eventId: event.eventId,
                        playerId: currentUser.uid,
                        player2Id: partner.uid,
                        teamId: teamId,
                        status: "CONFIRMED", // Or WAITLIST based on logic above
                        partnerStatus: "PENDING",
                        isPrimary: true,
                        invite: invite, // For debugging    
                        _debugSource: "useTeamInvite Hook",
                        registeredAt: Timestamp.now()
                    });
                }
                else if (inviteMode === "MERGE_P1") {
                    // UPDATE Logic for Partner in Position 1
                    if (!targetRegId) throw new Error("Missing target registration");
                    const regRef = doc(db, "registrations", targetRegId);

                    transaction.update(regRef, {
                        isPrimary: false,       // As requested: Update isPrimary to false
                        player2Id: currentUser.uid, // As requested: Add current user to player2Id
                        fullNameP2: currentUser.displayName,
                        partnerStatus: "PENDING",
                        teamId: teamId,
                        lookingForPartner: false // No longer looking
                    });
                }
                else if (inviteMode === "MERGE_P2") {
                    // UPDATE Logic for Partner in Position 2
                    if (!targetRegId) throw new Error("Missing target registration");
                    const regRef = doc(db, "registrations", targetRegId);

                    transaction.update(regRef, {
                        playerId: currentUser.uid,  // As requested: Add current user to playerId
                        fullNameP1: currentUser.displayName,
                        isPrimary: true,        // As requested: set isPrimary to true
                        partnerStatus: "PENDING",
                        teamId: teamId,
                        invite: invite, // For debugging    
                        _debugSource: "useTeamInvite Hook",
                        lookingForPartner: false
                    });
                }

                // E. Create Notification (Common)
                const notifRef = doc(collection(db, "notifications"));
                transaction.set(notifRef, {
                    notificationId: notifRef.id,
                    userId: partner.uid,
                    type: "partner_invite",
                    title: "Team Invite",
                    message: `${currentUser.displayName} wants to team up with you for ${event.eventName}`,
                    fromUserId: currentUser.uid,
                    eventId: event.eventId,
                    teamId: teamId,
                    read: false,
                    createdAt: Timestamp.now(),
                    invite: invite, // For debugging    
                    _debugSource: "useTeamInvite Hook"
                });
            });

            if (onSuccess) onSuccess();

        } catch (err: any) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return { sendInvite, loading, error };
};