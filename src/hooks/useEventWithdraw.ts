// src/hooks/useEventWithdraw.ts
import { useState } from "react";
import {
    doc,
    collection,
    query,
    where,
    getDocs,
    getDoc,
    updateDoc,
    deleteDoc,
    setDoc,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { User } from "firebase/auth";
import { EventData, Registration } from "@/lib/types";

export const useEventWithdraw = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const withdraw = async (
        user: User,
        event: EventData,
        registration: Registration | null,
        teamId: string | null,
        onSuccess?: () => void
    ) => {
        if (!user || !event) return;
        setLoading(true);
        setError(null);

        try {
            console.log(`[useEventWithdraw] Initiating withdrawal for user ${user.uid} in event ${event.eventId} (${event.unitType})`);

            let handled = false;

            // =========================================================================
            // PATH 1: PLAYERS MODE (Scenario 14 in scenarios.json)
            // =========================================================================
            if (event.unitType === "Players") {
                // 1. Locate User's Registration
                let targetRegId: string | null = null;
                let initialStatus = "CONFIRMED";

                const regQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", event.eventId),
                    where("playerId", "==", user.uid)
                );
                const regSnap = await getDocs(regQuery);
                const activeDoc = regSnap.docs.find(d => d.data().status !== "CANCELLED");

                if (activeDoc) {
                    targetRegId = activeDoc.id;
                    initialStatus = (activeDoc.data().status as string) || "CONFIRMED";
                } else if (registration) {
                    const regId = registration.registrationId || (registration as unknown as { id?: string }).id;
                    if (regId) {
                        const directSnap = await getDoc(doc(db, "registrations", regId));
                        if (directSnap.exists() && directSnap.data().status !== "CANCELLED") {
                            targetRegId = directSnap.id;
                            initialStatus = (directSnap.data().status as string) || "CONFIRMED";
                        }
                    }
                }

                if (!targetRegId) {
                    console.warn("[useEventWithdraw] No active registration found for player. Marking done.");
                    if (onSuccess) onSuccess();
                    return;
                }

                // 2. Change Player Registration status to CANCELLED
                await updateDoc(doc(db, "registrations", targetRegId), {
                    status: "CANCELLED",
                    cancelledAt: serverTimestamp(),
                    isPrimary: false,
                    lookingForPartner: false,
                    partnerStatus: "CANCELLED",
                    _debugSource: "useEventWithdraw - Scenario 14"
                });
                console.log(`[useEventWithdraw] Player registration ${targetRegId} status set to CANCELLED.`);

                // 3. Handle Waitlist Promotion & Event Counts (Scenario 14)
                try {
                    const eventRef = doc(db, "events", event.eventId);
                    const eventSnap = await getDoc(eventRef);

                    if (eventSnap.exists()) {
                        const eventData = eventSnap.data();
                        const currentRegCount = (eventData.registrationsCount as number) || 0;
                        const currentWaitlistCount = (eventData.waitlistCount as number) || 0;

                        if (initialStatus === "CONFIRMED") {
                            // Query for longest-waiting player on WAITLIST
                            const waitlistQuery = query(
                                collection(db, "registrations"),
                                where("eventId", "==", event.eventId),
                                where("status", "==", "WAITLIST")
                            );
                            const waitlistSnap = await getDocs(waitlistQuery);

                            if (!waitlistSnap.empty) {
                                const sortedDocs = [...waitlistSnap.docs].sort((a, b) => {
                                    const aTime = a.data().registeredAt?.toMillis ? a.data().registeredAt.toMillis() : 0;
                                    const bTime = b.data().registeredAt?.toMillis ? b.data().registeredAt.toMillis() : 0;
                                    return aTime - bTime;
                                });
                                const promotedDoc = sortedDocs[0];

                                // Promote Waitlist Candidate
                                await updateDoc(doc(db, "registrations", promotedDoc.id), {
                                    status: "CONFIRMED",
                                    waitlistPosition: null,
                                    promotedAt: serverTimestamp(),
                                });

                                // Decrement Waitlist Count (WT -1)
                                await updateDoc(eventRef, {
                                    waitlistCount: Math.max(0, currentWaitlistCount - 1),
                                });

                                // Notify Promoted Player
                                try {
                                    const notifRef = doc(collection(db, "notifications"));
                                    await setDoc(notifRef, {
                                        notificationId: notifRef.id,
                                        userId: promotedDoc.data().playerId,
                                        type: "WAITLIST_PROMOTED",
                                        title: "You're In!",
                                        message: `You've been promoted from the waitlist for ${event.eventName}!`,
                                        eventId: event.eventId,
                                        read: false,
                                        createdAt: serverTimestamp(),
                                    });
                                } catch (nErr) {
                                    console.warn("[useEventWithdraw] Notification failed:", nErr);
                                }
                                console.log(`[useEventWithdraw] Promoted waitlist player ${promotedDoc.id} to CONFIRMED.`);
                            } else {
                                // No waitlist -> Decrement registrationsCount (eventCount -1)
                                await updateDoc(eventRef, {
                                    registrationsCount: Math.max(0, currentRegCount - 1),
                                });
                                console.log(`[useEventWithdraw] Decremented registrationsCount to ${Math.max(0, currentRegCount - 1)}.`);
                            }
                        } else if (initialStatus === "WAITLIST") {
                            // Player was on waitlist -> Decrement waitlistCount (WT -1)
                            await updateDoc(eventRef, {
                                waitlistCount: Math.max(0, currentWaitlistCount - 1),
                            });
                        }
                    }
                } catch (countErr) {
                    console.warn("[useEventWithdraw] Non-blocking count update error:", countErr);
                }

                handled = true;
            }

            // =========================================================================
            // PATH 2: TEAMS MODE (Scenarios 3, 5, 6, 7, 15 in scenarios.json)
            // =========================================================================
            else if (event.unitType === "Teams") {
                // Find all registrations associated with user
                const regQ1 = query(
                    collection(db, "registrations"),
                    where("eventId", "==", event.eventId),
                    where("playerId", "==", user.uid)
                );
                const regQ2 = query(
                    collection(db, "registrations"),
                    where("eventId", "==", event.eventId),
                    where("player2Id", "==", user.uid)
                );
                const [snap1, snap2] = await Promise.all([getDocs(regQ1), getDocs(regQ2)]);
                const userRegDocs = [...snap1.docs, ...snap2.docs].filter(d => d.data().status !== "CANCELLED");

                let foundTeamId: string | null = null;
                let teamData: Record<string, unknown> | null = null;

                if (teamId) {
                    const tDoc = await getDoc(doc(db, "teams", teamId));
                    if (tDoc.exists()) {
                        foundTeamId = tDoc.id;
                        teamData = tDoc.data();
                    }
                }
                if (!foundTeamId) {
                    const tQuery1 = query(collection(db, "teams"), where("eventId", "==", event.eventId), where("player1Id", "==", user.uid));
                    const tQuery2 = query(collection(db, "teams"), where("eventId", "==", event.eventId), where("player2Id", "==", user.uid));
                    const [tSnap1, tSnap2] = await Promise.all([getDocs(tQuery1), getDocs(tQuery2)]);
                    if (!tSnap1.empty) {
                        foundTeamId = tSnap1.docs[0].id;
                        teamData = tSnap1.docs[0].data();
                    } else if (!tSnap2.empty) {
                        foundTeamId = tSnap2.docs[0].id;
                        teamData = tSnap2.docs[0].data();
                    }
                }

                if (!foundTeamId || !teamData) {
                    // Scenario 15: Free Agent Withdraw (Solo looking for partner in Teams event)
                    console.log("[useEventWithdraw] Scenario 15: Free Agent Withdraw");
                    for (const rDoc of userRegDocs) {
                        await updateDoc(doc(db, "registrations", rDoc.id), {
                            status: "CANCELLED",
                            cancelledAt: serverTimestamp(),
                            isPrimary: false,
                            lookingForPartner: false,
                            partnerStatus: "CANCELLED",
                            _debugSource: "useEventWithdraw - Scenario 15"
                        });
                    }
                } else {
                    // Team exists (Scenarios 3, 5, 6, 7)
                    const p1Id = teamData.player1Id as string;
                    const p2Id = teamData.player2Id as string;
                    const isP1 = user.uid === p1Id;
                    const survivorId = isP1 ? p2Id : p1Id;
                    const initialTeamStatus = (teamData.status as string) || "CONFIRMED";

                    console.log(`[useEventWithdraw] Team Dissolve: Actor=${isP1 ? "P1" : "P2"}, Survivor=${survivorId}, Status=${initialTeamStatus}`);

                    // Delete the team document
                    await deleteDoc(doc(db, "teams", foundTeamId)).catch(() => {});

                    // Update Leaver's registration to CANCELLED
                    for (const rDoc of userRegDocs) {
                        const d = rDoc.data();
                        if (d.playerId === user.uid) {
                            if (survivorId) {
                                // Transfer / promote survivor into a clean free agent registration
                                await updateDoc(doc(db, "registrations", rDoc.id), {
                                    playerId: survivorId,
                                    fullNameP1: (teamData.fullNameP2 as string) || (d.fullNameP2 as string) || "Partner",
                                    player2Id: null,
                                    fullNameP2: null,
                                    player2Confirmed: false,
                                    teamId: null,
                                    lookingForPartner: true,
                                    partnerStatus: "NONE",
                                    isPrimary: true,
                                    invite: null,
                                    _debugSource: "useEventWithdraw - Survivor Promoted"
                                });
                            } else {
                                await updateDoc(doc(db, "registrations", rDoc.id), {
                                    status: "CANCELLED",
                                    cancelledAt: serverTimestamp(),
                                    isPrimary: false,
                                    lookingForPartner: false,
                                    partnerStatus: "CANCELLED",
                                });
                            }
                        } else if (d.player2Id === user.uid) {
                            // Detach leaver (P2)
                            await updateDoc(doc(db, "registrations", rDoc.id), {
                                player2Id: null,
                                fullNameP2: null,
                                player2Confirmed: false,
                                teamId: null,
                                lookingForPartner: true,
                                partnerStatus: "NONE",
                                invite: null,
                            });
                        }
                    }

                    // Handle Event count changes and waitlist promotions for Confirmed / Waitlist teams
                    try {
                        const eventRef = doc(db, "events", event.eventId);
                        const eventSnap = await getDoc(eventRef);
                        if (eventSnap.exists()) {
                            const eventData = eventSnap.data();
                            const currentRegCount = (eventData.registrationsCount as number) || 0;
                            const currentWaitlistCount = (eventData.waitlistCount as number) || 0;

                            if (initialTeamStatus === "CONFIRMED") {
                                // Check for waitlist team (Scenario 5)
                                const waitlistTeamQuery = query(
                                    collection(db, "teams"),
                                    where("eventId", "==", event.eventId),
                                    where("status", "==", "WAITLIST")
                                );
                                const waitlistTeamSnap = await getDocs(waitlistTeamQuery);

                                if (!waitlistTeamSnap.empty) {
                                    const sortedTeams = [...waitlistTeamSnap.docs].sort((a, b) => {
                                        const aTime = a.data().createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
                                        const bTime = b.data().createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
                                        return aTime - bTime;
                                    });
                                    const promotedTeam = sortedTeams[0];

                                    await updateDoc(doc(db, "teams", promotedTeam.id), {
                                        status: "CONFIRMED",
                                        promotedAt: serverTimestamp(),
                                    });

                                    await updateDoc(eventRef, {
                                        waitlistCount: Math.max(0, currentWaitlistCount - 1),
                                    });
                                } else {
                                    await updateDoc(eventRef, {
                                        registrationsCount: Math.max(0, currentRegCount - 1),
                                    });
                                }
                            } else if (initialTeamStatus === "WAITLIST") {
                                // Scenario 7: Waitlist team leaves -> Decrement WT count
                                await updateDoc(eventRef, {
                                    waitlistCount: Math.max(0, currentWaitlistCount - 1),
                                });
                            }
                        }
                    } catch (tCountErr) {
                        console.warn("[useEventWithdraw] Non-blocking team count error:", tCountErr);
                    }

                    // Notify survivor if exists
                    if (survivorId) {
                        try {
                            const notifRef = doc(collection(db, "notifications"));
                            await setDoc(notifRef, {
                                notificationId: notifRef.id,
                                userId: survivorId,
                                type: "system",
                                title: "Partner Left",
                                message: `Your partner has withdrawn from ${event.eventName}. You are now listed as a Free Agent.`,
                                eventId: event.eventId,
                                read: false,
                                createdAt: serverTimestamp(),
                            });
                        } catch (sNotifErr) {
                            console.warn("[useEventWithdraw] Survivor notification error:", sNotifErr);
                        }
                    }
                }

                handled = true;
            }

            // Fallback to server API if needed
            if (!handled) {
                const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : "";
                const res = await fetch("/api/events/withdraw", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
                    },
                    body: JSON.stringify({
                        eventId: event.eventId,
                        targetUid: user.uid,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || "Failed to withdraw");
                }
            }

            console.log("[useEventWithdraw] Withdrawal finished successfully.");
            if (onSuccess) onSuccess();

        } catch (err: unknown) {
            console.error("[useEventWithdraw] Error:", err);
            const msg = err instanceof Error ? err.message : "Failed to withdraw";
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    return { withdraw, loading, error };
};