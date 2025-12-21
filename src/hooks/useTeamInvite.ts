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
                where("status", "==", "CONFIRMED"),
                where("partnerStatus", "==", "CONFIRMED")
            );

            // Check D: is the partner the "Secondary Player" (P2) in any confirmed registration?
            const fourthCheck = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", partner.uid),
                where("partnerStatus", "==", "CONFIRMED")
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

            // Check F: Is the partner in a PENDING team (either as P1 or P2) in the TEAMS collection?
            // "your code should check if the potential partner (player2) is already in a Pending Team in the TEAMS collection."
            const teamsRef = collection(db, "teams");

            const pendingTeamP1Check = query(
                teamsRef,
                where("eventId", "==", event.eventId),
                where("player1Id", "==", partner.uid),
                where("status", "==", "PENDING")
            );

            const pendingTeamP2Check = query(
                teamsRef,
                where("eventId", "==", event.eventId),
                where("player2Id", "==", partner.uid),
                where("status", "==", "PENDING")
            );

            const [pendingTeamP1Snap, pendingTeamP2Snap] = await Promise.all([
                getDocs(pendingTeamP1Check),
                getDocs(pendingTeamP2Check)
            ]);
            console.log("Pending team queries outcome:", {
                partnerAsP1Pending: !pendingTeamP1Snap.empty,
                partnerAsP2Pending: !pendingTeamP2Snap.empty
            });

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

            // Priority 2: Partner is Confirmed OR Pending P1 -> Are they looking?
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
            // Priority 2b: Partner is in a PENDING Team (as P1 or P2)
            else if (!pendingTeamP1Snap.empty || !pendingTeamP2Snap.empty) {
                // If they are in a pending team, they are generally "busy" waiting for someone,
                // UNLESS they are explicitly marked as "lookingForPartner" (which means they are open to other offers).
                // However, TEAMS collection doesn't have "lookingForPartner". Registrations do.
                // We checked "registrations" in fifthCheck (P2) and thirdCheck (P1 Confirmed). 
                // We need to know if they have a REGISTRATION corresponding to this Team that says "looking".

                // Simplified Logic: 
                // IF they are P1 in a Pending Team -> They initiated. Check if they are still looking?
                // IF they are P2 in a Pending Team -> They received. Check if they accepted? (If accepted -> Confirmed. If PENDING -> pending).

                // If they are P1 in Pending Team:
                if (!pendingTeamP1Snap.empty) {
                    // They are waiting for someone. We allow efficient "poaching" ONLY if we assume they are open.
                    // But usually creating a team makes you "Pending" and not "Looking" generally?
                    // Actually, if I create a team "Me + You", I am Pending. I am NOT looking for anyone else.
                    // So I should be BLOCKED from receiving invites?
                    // USER SAID: "if partner is already registered in a Team with status confirmed or waitlist ... if no allow invites"
                    // So PENDING teams should be IGNORED/ALLOWED.

                    // So we treat this as MERGE_P1 logic usually?
                    // But we need a target registration to merge into.
                    // If they are P1 of a pending team, they likely have a corresponding PENDING registration.
                    // Let's try to find it.
                    const p1RegQuery = query(registrationsRef, where("teamId", "==", pendingTeamP1Snap.docs[0].id), where("playerId", "==", partner.uid));
                    const p1RegSnap = await getDocs(p1RegQuery);
                    if (!p1RegSnap.empty) {
                        inviteMode = "MERGE_P1";
                        targetRegId = p1RegSnap.docs[0].id;
                    }
                    // If no registration found, it's a loose invite. We can treat as FRESH or MERGE (safe to defaults).
                }
                else if (!pendingTeamP2Snap.empty) {
                    // They are P2 in a Pending Team.
                    // If they have a "lookingForPartner" registration (fifthCheck), we catch it in Priority 3.
                    // If they DON'T have a registration (loose invite), we can treat as FRESH.
                }

                // Fallback: If we didn't catch specific registration above, we allow it (FRESH) or let Priority 3 catch it.
            }

            // Priority 3: Partner is Pending P2 (Orphan P2) -> Are they looking?
            if (!fifthSnap.empty) {
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
                    // CHANGED: Even if they are P1 in their registration, 
                    // in this NEW Team Invite, I am P1 because I am the Initiator.
                    p1Id = currentUser.uid;
                    p2Id = partner.uid;
                    p1Name = senderName;
                    p2Name = partner.displayName;
                    p1Confirmed = true;  // I am confirmed (Inviter)
                    p2Confirmed = false; // Partner must accept (Target)
                    inviteType = "MERGE_P1";
                    targetUserId = p2Id; // Notification goes to P2 (The Partner)
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
                        status: "CONFIRMED",
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
                    // We need to create a registration for ME (The Inviter, P1) because I am "New" to the event (or at least not the one holding the Free Agent spot).
                    // We do NOT update the Free Agent's (P2) registration here. They stay "Looking" until they accept.

                    // Optimization: Update existing registration instead of delete + create
                    // This is safer and cleaner for Firebase transactions.
                    if (myExistingRegId) {
                        const existingRegRef = doc(db, "registrations", myExistingRegId);
                        transaction.update(existingRegRef, {
                            // Core Team Data
                            teamId: teamId,
                            player2Id: partner.uid,
                            fullNameP2: partner.displayName,

                            // Status Updates
                            status: "CONFIRMED", // Inviter is CONFIRMED per scenarios.json
                            partnerStatus: "PENDING",
                            invite: inviteType,
                            lookingForPartner: false, // I am waiting for this specific person

                            // Metadata
                            _debugSource: "useTeamInvite - MERGE_P1 (Updated)",
                            _lastUpdated: serverTimestamp()
                        });
                    } else {
                        // Create New Registration if I didn't have one
                        const regRef = doc(collection(db, "registrations"));
                        transaction.set(regRef, {
                            registrationId: regRef.id,
                            eventId: event.eventId,
                            playerId: currentUser.uid,
                            player2Id: partner.uid,
                            fullNameP1: senderName,
                            fullNameP2: partner.displayName,
                            teamId: teamId,
                            status: "CONFIRMED", // Inviter is CONFIRMED per scenarios.json
                            partnerStatus: "PENDING",
                            isPrimary: true,
                            invite: inviteType,
                            lookingForPartner: false,
                            _debugSource: "useTeamInvite - MERGE_P1 (New)",
                            registeredAt: Timestamp.now()
                        });
                    }
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