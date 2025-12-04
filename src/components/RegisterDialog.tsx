
"use client";

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { db } from "@/lib/firebase";
import { doc, runTransaction, Timestamp, collection, query, where, getDocs, DocumentData } from "firebase/firestore";
import { User } from "firebase/auth";
import { EventData } from "./EventCard";
import { Registration } from "@/lib/types";

interface RegisterDialogProps {
    event: EventData;
    user: User | null;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export function RegisterDialog({ event, user, trigger, onSuccess, open: controlledOpen, onOpenChange: setControlledOpen }: RegisterDialogProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = isControlled ? setControlledOpen : setInternalOpen;

    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const [isRegistered, setIsRegistered] = useState(false);
    const [existingRegistration, setExistingRegistration] = useState<Registration | null>(null);

    const checkRegistration = useCallback(async () => {
        if (!user) return;
        const q = query(
            collection(db, "registrations"),
            where("eventId", "==", event.eventId),
            where("playerId", "==", user.uid),
            where("status", "in", ["CONFIRMED", "WAITLIST"])
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            setIsRegistered(true);
            setExistingRegistration({ registrationId: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Registration);
        } else {
            setIsRegistered(false);
            setExistingRegistration(null);
        }
    }, [user, event.eventId]);

    // Check registration status on open
    useEffect(() => {
        if (open && user) {
            checkRegistration();
        }
    }, [open, user, checkRegistration]);

    const handleRegister = async () => {
        if (!user) return;
        console.log("Registering for event:", event.eventId, "Event Data:", event);
        setLoading(true);

        try {
            // Fetch user profile for details
            let userProfile: DocumentData = {};
            try {
                const userDoc = await getDocs(query(collection(db, "users"), where("uid", "==", user.uid)));
                if (!userDoc.empty) {
                    userProfile = userDoc.docs[0].data();
                }
            } catch (e) {
                console.error("Error fetching user profile:", e);
            }

            // Query to count ONLY confirmed registrations BEFORE transaction (exclude CANCELLED)
            const confirmedRegsQuery = query(
                collection(db, "registrations"),
                where("eventId", "==", event.eventId),
                where("status", "==", "CONFIRMED")
            );
            const confirmedRegsSnapshot = await getDocs(confirmedRegsQuery);
            const currentConfirmedCount = confirmedRegsSnapshot.size;

            await runTransaction(db, async (transaction) => {
                const eventRef = doc(db, "events", event.eventId);
                console.log("Transaction: Getting event doc:", eventRef.path);
                const eventDoc = await transaction.get(eventRef);
                console.log("Transaction: Event doc exists?", eventDoc.exists());

                if (!eventDoc.exists()) {
                    console.error("Transaction: Event not found at path:", eventRef.path);
                    throw new Error(`Event does not exist! Path: ${eventRef.path}`);
                }

                const currentEventData = eventDoc.data();
                const slotsAvailable = currentEventData.slotsAvailable;

                console.log("Registration check:", {
                    currentConfirmedCount,
                    slotsAvailable,
                    registrationsCount: currentEventData.registrationsCount,
                    isFull: currentConfirmedCount >= slotsAvailable
                });

                const isFull = currentConfirmedCount >= slotsAvailable;
                const status = isFull ? "WAITLIST" : "CONFIRMED";

                // Create registration
                const newRegRef = doc(collection(db, "registrations"));
                const registrationData = {
                    registrationId: newRegRef.id,
                    eventId: event.eventId,
                    playerId: user.uid,
                    registeredAt: Timestamp.now(),
                    status: status,
                    isPrimary: true,
                    waitlistPosition: isFull ? (currentEventData.waitlistCount || 0) + 1 : 0,
                    fullNameP1: userProfile.displayName || userProfile.fullName || user.displayName || "Unknown Player",
                    playerPhotoURL: userProfile.photoURL || userProfile.photoUrl || user.photoURL || "",
                    playerSkillLevel: userProfile.skillLevel || userProfile.level || "Beginner",
                    playerHand: userProfile.hand || "Right",
                    playerPosition: userProfile.position || "Both",
                    playerLevel: userProfile.skillLevel || userProfile.level || "Beginner", // Keep for compatibility
                    fullNameP2: null // Explicitly null for single players
                };

                transaction.set(newRegRef, registrationData);

                // Update event counts
                if (isFull) {
                    transaction.update(eventRef, {
                        waitlistCount: (currentEventData.waitlistCount || 0) + 1
                    });
                } else {
                    transaction.update(eventRef, {
                        registrationsCount: currentConfirmedCount + 1
                    });
                }
            });

            showToast("Successfully registered!", "success");
            if (onSuccess) onSuccess();
            if (setOpen) setOpen(false);

        } catch (error) {
            console.error("Registration error:", error);
            showToast("Failed to register. Please try again.", "error");
        } finally {
            setLoading(false);
        }
    };

    const handleWithdraw = async () => {
        if (!existingRegistration) return;
        setLoading(true);
        try {
            // Query waitlist players BEFORE transaction (if withdrawing a confirmed registration)
            let firstWaitlistPlayer: { id: string; playerId: string; waitlistPosition?: number;[key: string]: any } | null = null;

            if (existingRegistration.status === "CONFIRMED") {
                const waitlistQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", event.eventId),
                    where("status", "==", "WAITLIST")
                );
                const waitlistSnapshot = await getDocs(waitlistQuery);

                if (!waitlistSnapshot.empty) {
                    // Sort by waitlistPosition to get FIFO order
                    const waitlistPlayers = waitlistSnapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() } as { id: string; playerId: string; waitlistPosition?: number;[key: string]: any }))
                        .sort((a, b) => (a.waitlistPosition || 0) - (b.waitlistPosition || 0));

                    firstWaitlistPlayer = waitlistPlayers[0];
                }
            }

            await runTransaction(db, async (transaction) => {
                const eventRef = doc(db, "events", event.eventId);
                const regRef = doc(db, "registrations", existingRegistration.registrationId);

                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("Event not found");

                const currentEventData = eventDoc.data();

                // Change status to CANCELLED instead of deleting
                transaction.update(regRef, {
                    status: "CANCELLED",
                    cancelledAt: Timestamp.now()
                });

                // Update event counts and promote waitlist player
                if (existingRegistration.status === "CONFIRMED") {
                    transaction.update(eventRef, {
                        registrationsCount: Math.max(0, (currentEventData.registrationsCount || 0) - 1)
                    });

                    // Promote first waitlist player if exists
                    if (firstWaitlistPlayer) {
                        const firstWaitlistRef = doc(db, "registrations", firstWaitlistPlayer.id);

                        // Promote to CONFIRMED
                        transaction.update(firstWaitlistRef, {
                            status: "CONFIRMED",
                            waitlistPosition: 0,
                            promotedAt: Timestamp.now()
                        });

                        // Update event counts (replace withdrawn player with promoted player)
                        transaction.update(eventRef, {
                            registrationsCount: currentEventData.registrationsCount || 0, // Keep same count
                            waitlistCount: Math.max(0, (currentEventData.waitlistCount || 0) - 1)
                        });

                        // Create notification for promoted player
                        const notificationRef = doc(collection(db, "notifications"));
                        transaction.set(notificationRef, {
                            userId: firstWaitlistPlayer.playerId,
                            type: "WAITLIST_PROMOTED",
                            message: `You've been promoted from the waitlist for ${event.eventName}!`,
                            eventId: event.eventId,
                            eventName: event.eventName,
                            read: false,
                            createdAt: Timestamp.now()
                        });
                    }
                } else if (existingRegistration.status === "WAITLIST") {
                    transaction.update(eventRef, {
                        waitlistCount: Math.max(0, (currentEventData.waitlistCount || 0) - 1)
                    });
                }
            });

            showToast("Successfully withdrawn from event.", "success");
            if (onSuccess) onSuccess();
            if (setOpen) setOpen(false);
        } catch (error) {
            console.error("Withdraw error:", error);
            showToast("Failed to withdraw.", "error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || <Button>Register</Button>}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{isRegistered ? "Manage Registration" : `Register for ${event.eventName}`}</DialogTitle>
                    <DialogDescription>
                        {isRegistered
                            ? "You are currently registered for this event."
                            : event.pricePerPlayer > 0
                                ? `The price for this event is ${event.pricePerPlayer} AED.`
                                : "This event is free to join."}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <p className="text-sm text-gray-600">
                        Date: {event.dateTime.toDate().toLocaleDateString()} <br />
                        Time: {event.dateTime.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} <br />
                        Location: {event.locationName}
                    </p>
                    {isRegistered && (
                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
                            Status: <strong>{existingRegistration?.status}</strong>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen && setOpen(false)} disabled={loading}>
                        Close
                    </Button>
                    {isRegistered ? (
                        <Button onClick={handleWithdraw} disabled={loading} variant="destructive">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Withdrawing...
                                </>
                            ) : (
                                "Withdraw"
                            )}
                        </Button>
                    ) : (
                        <Button onClick={handleRegister} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Registering...
                                </>
                            ) : (
                                "Confirm Registration"
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

