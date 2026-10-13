
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { db } from "@/lib/firebase";
import { doc, setDoc, runTransaction, Timestamp, collection, query, where, getDocs, DocumentData, limit, deleteField } from "firebase/firestore";
import { User } from "firebase/auth";
import { EventData } from "./EventCard";
import { Registration } from "@/lib/types";
import { useEventWithdraw } from "@/hooks/useEventWithdraw";
import { t } from "@/lib/i18n";
import { EventTermsModal } from "@/components/EventTermsModal";
import { checkPlayerEligibility } from "@/lib/authRequirements";
import { LateWithdrawalWarningDialog } from "@/components/LateWithdrawalWarningDialog";

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
    const [isLateWarningOpen, setIsLateWarningOpen] = useState(false);
    const [lateWarningMessage, setLateWarningMessage] = useState("");

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
            setExistingRegistration({ ...snapshot.docs[0].data(), id: snapshot.docs[0].id, registrationId: snapshot.docs[0].id } as unknown as Registration);
        } else {
            setIsRegistered(false);
            setExistingRegistration(null);
        }
    }, [user, event.eventId]);

    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [termsModalOpen, setTermsModalOpen] = useState(false);

    // Check registration status on open
    useEffect(() => {
        if (open) {
            setAgreedToTerms(false);
            if (user) {
                checkRegistration();
            }
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

            // Check eligibility (email verification & phone number)
            const eligibility = await checkPlayerEligibility(user, userProfile);
            if (!eligibility.eligible) {
                showToast(eligibility.message, "error");
                setLoading(false);
                isRegisteringRef.current = false;
                if (setOpen) setOpen(false);
                return;
            }

            // Sync verified email to user profile doc if needed
            if (user.emailVerified && !userProfile.emailVerified && !userProfile.is_email_verified) {
                try {
                    const userDocRef = doc(db, "users", user.uid);
                    await setDoc(userDocRef, { emailVerified: true }, { merge: true });
                } catch (e) {
                    console.warn("Could not sync emailVerified to user doc:", e);
                }
            }

            // Call trusted server-side registration API
            const idToken = await user.getIdToken();
            const response = await fetch("/api/events/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ eventId: event.eventId }),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || "Failed to register.");
            }

            showToast(t("Successfully registered!"), "success");
            if (onSuccess) onSuccess();
            if (setOpen) setOpen(false);

        } catch (error) {
            console.error(t("Registration error:"), error);
            const errorMessage = error instanceof Error ? error.message : "";
            if (errorMessage === "REDFLAGGED") {
                showToast("Your account is red-flagged. You cannot register until approved by an administrator.", "error");
                if (setOpen) setOpen(false);
            } else if (errorMessage === "ALREADY_REGISTERED") {
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

    const executeWithdraw = async (confirmLate: boolean = false) => {
        if (!user || !existingRegistration || isWithdrawingRef.current) return;
        isWithdrawingRef.current = true;

        try {
            const result = await withdraw(user, event, existingRegistration, null, () => {
                showToast("Successfully withdrawn from event.", "success");
                if (onSuccess) onSuccess();
                if (setOpen) setOpen(false);
            }, confirmLate);

            if (result?.requiresConfirmation) {
                setLateWarningMessage(result.message || "Withdrawing within 18 hours of event start will result in a red flag on your account.");
                setIsLateWarningOpen(true);
            }
        } catch {
            showToast("Failed to withdraw.", "error");
        } finally {
            isWithdrawingRef.current = false;
        }
    };

    const handleWithdraw = () => executeWithdraw(false);

    const handleConfirmLate = async () => {
        setIsLateWarningOpen(false);
        await executeWithdraw(true);
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
                    {isRegistered ? (
                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
                            {t("Status:")} <strong>{existingRegistration?.status}</strong>
                        </div>
                    ) : (
                        <div className="mt-4 pt-3 border-t border-gray-100 flex items-start gap-2.5">
                            <input
                                type="checkbox"
                                id="agree-terms-single"
                                checked={agreedToTerms}
                                onChange={(e) => setAgreedToTerms(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                            />
                            <label htmlFor="agree-terms-single" className="text-xs text-gray-600 leading-normal cursor-pointer select-none">
                                I have read and agree to the{" "}
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); setTermsModalOpen(true); }}
                                    className="text-orange-600 font-semibold underline hover:text-orange-700"
                                >
                                    Event Terms & Conditions
                                </button>{" "}
                                and cancellation policy.
                            </label>
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
                        <Button onClick={handleRegister} disabled={loading || !agreedToTerms} className="bg-orange-500 hover:bg-orange-600 text-white font-medium">
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

                <EventTermsModal
                    event={event}
                    open={termsModalOpen}
                    onOpenChange={setTermsModalOpen}
                />

                <LateWithdrawalWarningDialog
                    open={isLateWarningOpen}
                    onOpenChange={setIsLateWarningOpen}
                    onConfirm={handleConfirmLate}
                    message={lateWarningMessage}
                />
            </DialogContent>
        </Dialog>
    );
}

