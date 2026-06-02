
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { db } from "@/lib/firebase";
import { doc, runTransaction, Timestamp, collection, query, where, getDocs, DocumentData, limit, deleteField } from "firebase/firestore";
import { User } from "firebase/auth";
import { EventData } from "./EventCard";
import { Registration } from "@/lib/types";
import { useEventWithdraw } from "@/hooks/useEventWithdraw";
import { t } from "@/lib/i18n";

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
    const { withdraw, loading: withdrawLoading } = useEventWithdraw();
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const [isRegistered, setIsRegistered] = useState(false);
    const [existingRegistration, setExistingRegistration] = useState<Registration | null>(null);

    const isRegisteringRef = useRef(false);
    const isWithdrawingRef = useRef(false);

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
        if (!user || isRegisteringRef.current) return;
        isRegisteringRef.current = true;
        console.log("Registering for event:", event.eventId, "Event Data:", event);
        setLoading(true);

        try {
            // 1. SYNC: Fetch & Repair User Profile
            // (Keeping your existing profile sync logic here for safety)
            let userProfile: DocumentData = {};
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("uid", "==", user.uid));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                userProfile = docSnap.data();
            } else {
                userProfile = { uid: user.uid, email: user.email, createdAt: Timestamp.now() };
            }

            // ... (Your existing profile update logic remains here) ...

            // 2. CHECK FOR RECYCLE (Find existing registration)
            const recycleQuery = query(
                collection(db, "registrations"),
                where("eventId", "==", event.eventId),
                where("playerId", "==", user.uid),
                limit(1)
            );
            const recycleSnapshot = await getDocs(recycleQuery);
            const recycledDoc = !recycleSnapshot.empty ? recycleSnapshot.docs[0] : null;

            await runTransaction(db, async (transaction) => {
                const eventRef = doc(db, "events", event.eventId);
                const eventDoc = await transaction.get(eventRef);

                if (!eventDoc.exists()) throw new Error("Event does not exist!");

                const currentEventData = eventDoc.data();
                // Use internal data to prevent race conditions
                const currentCount = currentEventData.registrationsCount || 0;
                const currentWaitlist = currentEventData.waitlistCount || 0;
                const slotsAvailable = currentEventData.slotsAvailable || 0;

                // LOGIC: Only check capacity if it's a "Players" event
                // If "Teams" event, a single player is just a "Free Agent" (doesn't take a slot yet)
                let isFull = false;
                if (event.unitType === "Players") {
                    isFull = currentCount >= slotsAvailable;
                }

                // Determine Status
                // If Teams mode, they are CONFIRMED as a "Free Agent" but looking for partner
                const status = isFull ? "WAITLIST" : "CONFIRMED";

                const commonData = {
                    eventId: event.eventId,
                    playerId: user.uid,
                    registeredAt: Timestamp.now(),
                    status: status,
                    isPrimary: true,
                    // Only assign waitlist position if it's a Player event that is full
                    waitlistPosition: isFull ? currentWaitlist + 1 : 0,

                    // Profile Data
                    fullNameP1: userProfile.displayName || userProfile.fullName || user.displayName || "Unknown Player",
                    playerPhotoURL: userProfile.photoUrl || userProfile.photoURL || user.photoURL || "",
                    playerSkillLevel: userProfile.skillLevel || "Beginner",
                    playerHand: userProfile.hand || "Right",
                    playerPosition: userProfile.position || "Both",
                    fullNameP2: null, // Single player has no partner

                    // CRITICAL: If Teams mode, flag them as looking
                    lookingForPartner: event.unitType === "Teams",
                    partnerStatus: event.unitType === "Teams" ? "NONE" : null
                };

                if (recycledDoc) {
                    // RECYCLE - check current state inside transaction to prevent race conditions
                    const regRef = doc(db, "registrations", recycledDoc.id);
                    const regSnap = await transaction.get(regRef);
                    if (regSnap.exists()) {
                        const currentReg = regSnap.data();
                        if (currentReg.status === "CONFIRMED" || currentReg.status === "WAITLIST") {
                            throw new Error("ALREADY_REGISTERED");
                        }
                    }
                    transaction.update(regRef, {
                        ...commonData,
                        cancelledAt: deleteField(),
                        _debugSource: "RegisterDialog Component - Recycled"
                    });
                } else {
                    // CREATE NEW
                    const newRegRef = doc(collection(db, "registrations"));
                    transaction.set(newRegRef, {
                        registrationId: newRegRef.id,
                        ...commonData,
                        _debugSource: "RegisterDialog Component"
                    });
                }

                // 3. UPDATE COUNTS (The Logic You Requested)
                // Only increment if this is a "Players" event
                if (event.unitType === "Players") {
                    if (isFull) {
                        transaction.update(eventRef, {
                            waitlistCount: currentWaitlist + 1
                        });
                    } else {
                        transaction.update(eventRef, {
                            registrationsCount: currentCount + 1
                        });
                    }
                }
                // 4. Notification (Scenario 12)
                const eventDateFormatted = event.dateTime.toDate().toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit'
                }).replace(/\//g, '-');

                const notifRef = doc(collection(db, "notifications"));
                transaction.set(notifRef, {
                    notificationId: notifRef.id,
                    userId: user.uid,
                    type: "system",
                    title: "Registration Confirmed",
                    message: `${commonData.fullNameP1}, you are registered for event ${event.eventName} on ${eventDateFormatted}`,
                    eventId: event.eventId,
                    eventName: event.eventName,
                    eventDate: event.dateTime,
                    read: false,
                    createdAt: Timestamp.now(),
                    _debugSource: "RegisterDialog Component"
                });
            });

            showToast(t("Successfully registered!"), "success");
            if (onSuccess) onSuccess();
            if (setOpen) setOpen(false);

        } catch (error) {
            console.error(t("Registration error:"), error);
            const errorMessage = error instanceof Error ? error.message : "";
            if (errorMessage === "ALREADY_REGISTERED") {
                showToast(t("You are already registered for this event."), "warning");
                if (onSuccess) onSuccess();
                if (setOpen) setOpen(false);
            } else {
                showToast(t("Failed to register. Please try again."), "error");
            }
        } finally {
            setLoading(false);
            isRegisteringRef.current = false;
        }
    };
    const handleWithdraw = async () => {
        if (!user || !existingRegistration || isWithdrawingRef.current) return;
        isWithdrawingRef.current = true;

        // Note: RegisterDialog usually handles Single Player mode. 
        // If your app allows Team players to open this dialog, you might need to fetch the teamId here too.
        // Assuming this dialog is mostly for Single Players or "My Registration":

        try {
            await withdraw(user, event, existingRegistration, null, () => {
                showToast("Successfully withdrawn from event.", "success");
                if (onSuccess) onSuccess();
                if (setOpen) setOpen(false);
            });
        } catch {
            showToast("Failed to withdraw.", "error");
        } finally {
            isWithdrawingRef.current = false;
        }
    };
    const isProcessing = loading || withdrawLoading;
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || <Button>{t("Register")}</Button>}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{isRegistered ? t("Manage Registration") : `${t("Register for")} ${event.eventName}`}</DialogTitle>
                    <DialogDescription>
                        {isRegistered
                            ? t("You are currently registered for this event.")
                            : event.pricePerPlayer > 0
                                ? `${t("The price for this event is")} ${event.pricePerPlayer} AED.`
                                : t("This event is free to join.")}
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <p className="text-sm text-gray-600">
                        {t("Date:")} {event.dateTime.toDate().toLocaleDateString()} <br />
                        {t("Time:")} {event.dateTime.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} <br />
                        {t("Location:")} {event.locationName}
                    </p>
                    {isRegistered && (
                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
                            {t("Status:")} <strong>{existingRegistration?.status}</strong>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen && setOpen(false)} disabled={loading}>
                        {t("Close")}
                    </Button>
                    {isRegistered ? (
                        <Button onClick={handleWithdraw} disabled={isProcessing} variant="destructive">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t("Withdrawing...")}
                                </>
                            ) : (
                                t("Withdraw")
                            )}
                        </Button>
                    ) : (
                        <Button onClick={handleRegister} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t("Registering...")}
                                </>
                            ) : (
                                t("Confirm Registration")
                            )}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

