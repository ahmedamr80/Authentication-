// src/hooks/useEventWithdraw.ts
import { useState } from "react";
import {
    doc,
    runTransaction,
    collection,
    query,
    where,
    getDocs,
    Timestamp,
    DocumentData,
    orderBy,
    limit
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { User } from "firebase/auth";
import { EventData } from "@/components/EventCard"; // Adjust path if needed
import { Registration } from "@/lib/types";
import { useTeamDissolve } from "./useTeamDissolve";

// 1. Define a clear Interface to fix the TypeScript error
interface WaitlistRegistration extends DocumentData {
    id: string;
    playerId: string;
    waitlistPosition?: number;
    registeredAt: Timestamp;
}

export const useEventWithdraw = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Import the Team Dissolve logic
    const { dissolveTeam } = useTeamDissolve();

    const withdraw = async (
        user: User,
        event: EventData,
        registration: Registration | null,
        teamId: string | null, // Pass teamId if user is in a team
        onSuccess?: () => void
    ) => {
        if (!user || !event) return;
        setLoading(true);
        setError(null);

        try {
            // STRATEGY: If user is in a team, use the Team Dissolve logic.
            // Otherwise, use the Single Player withdrawal logic.

            if (teamId && event.unitType === "Teams") {
                // Delegate to existing hook
                await dissolveTeam(
                    user,
                    teamId,
                    event.eventId,
                    "LEAVE", // Action type is LEAVE
                    undefined, // No notification ID
                    onSuccess
                );
            } else {
                // SINGLE PLAYER / WAITLIST WITHDRAWAL LOGIC
                if (!registration) throw new Error("No registration found");

                // 1. Fetch Waitlist Candidates (Outside Transaction for speed)
                let firstWaitlistPlayer: WaitlistRegistration | null = null;

                if (registration.status === "CONFIRMED") {
                    // NEW LOGIC: Sort by registeredAt ASC to get the longest-waiting player
                    const waitlistQuery = query(
                        collection(db, "registrations"),
                        where("eventId", "==", event.eventId),
                        where("status", "==", "WAITLIST"),
                        orderBy("registeredAt", "asc"), // Time-Based Priority
                        limit(1)
                    );
                    const waitlistSnapshot = await getDocs(waitlistQuery);

                    if (!waitlistSnapshot.empty) {
                        const docSnapshot = waitlistSnapshot.docs[0];
                        firstWaitlistPlayer = {
                            id: docSnapshot.id,
                            ...docSnapshot.data()
                        } as WaitlistRegistration;
                    }
                }

                // 2. Run Atomic Transaction
                await runTransaction(db, async (transaction) => {
                    const eventRef = doc(db, "events", event.eventId);
                    const regRef = doc(db, "registrations", registration.registrationId);

                    // OPTIMISTIC READ: Verify waitlist candidate matches inside transaction
                    let waitlistSnap = null;
                    if (firstWaitlistPlayer) {
                        const waitlistRef = doc(db, "registrations", firstWaitlistPlayer.id);
                        waitlistSnap = await transaction.get(waitlistRef);
                    }

                    const eventDoc = await transaction.get(eventRef);

                    if (!eventDoc.exists()) throw new Error("Event not found");
                    const currentEventData = eventDoc.data();

                    // A. Cancel the User's Registration
                    transaction.update(regRef, {
                        status: "CANCELLED",
                        cancelledAt: Timestamp.now(),
                        isPrimary: false,
                        lookingForPartner: false,
                        _debugSource: "useEventWithdraw Hook - Cancel the User's Registration"

                    });

                    // B. Handle Counts & Promotion
                    const currentRegCount = currentEventData.registrationsCount || 0;
                    const currentWaitlistCount = currentEventData.waitlistCount || 0;

                    if (registration.status === "CONFIRMED") {
                        // CHECK: Do we have a valid waitlist snapshot?
                        if (waitlistSnap && waitlistSnap.exists()) {
                            // CASE: Confirmed player leaves, Waitlist player promoted.
                            // Net result: Registrations count stays same. Waitlist count decreases.

                            const firstWaitlistRef = waitlistSnap.ref;

                            // Promote
                            transaction.update(firstWaitlistRef, {
                                status: "CONFIRMED",
                                waitlistPosition: null, // Clear position as they are now confirmed
                                promotedAt: Timestamp.now()
                            });

                            // Update Event Counts
                            transaction.update(eventRef, {
                                waitlistCount: Math.max(0, currentWaitlistCount - 1)
                                // registrationsCount stays the same
                            });

                            // Notify Promoted Player
                            const notifRef = doc(collection(db, "notifications"));
                            const promotedPlayerId = firstWaitlistPlayer?.playerId || (waitlistSnap.data() as Registration).playerId;

                            transaction.set(notifRef, {
                                notificationId: notifRef.id,
                                userId: promotedPlayerId,
                                type: "WAITLIST_PROMOTED",
                                title: "You're In!",
                                message: `You've been promoted from the waitlist for ${event.eventName}!`,
                                eventId: event.eventId,
                                read: false,
                                createdAt: Timestamp.now()
                            });
                        } else {
                            // CASE: Confirmed player leaves, NO replacement.
                            transaction.update(eventRef, {
                                registrationsCount: Math.max(0, currentRegCount - 1)
                            });
                        }
                    } else if (registration.status === "WAITLIST") {
                        // CASE: Waitlist player leaves.
                        transaction.update(eventRef, {
                            waitlistCount: Math.max(0, currentWaitlistCount - 1)
                        });
                    }
                });

                if (onSuccess) onSuccess();
            }

        } catch (err: unknown) {
            console.error("Withdraw error:", err);
            const msg = err instanceof Error ? err.message : "Failed to withdraw";
            setError(msg);
            throw err; // Re-throw so UI can show toast
        } finally {
            setLoading(false);
        }
    };

    return { withdraw, loading, error };
};