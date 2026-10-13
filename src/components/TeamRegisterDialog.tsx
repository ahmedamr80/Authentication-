"use client";

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, UserPlus, User as UserIcon, AlertCircle } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, Timestamp, doc, limit, setDoc, updateDoc, DocumentData } from "firebase/firestore";
import { User } from "firebase/auth";
import { EventData } from "./EventCard";
import { useTeamRegistration } from "@/hooks/useTeamRegistration";
import { t } from "@/lib/i18n";
import { EventTermsModal } from "@/components/EventTermsModal";
import { checkPlayerEligibility } from "@/lib/authRequirements";
import { PlayerSearchAutocomplete } from "@/components/PlayerSearchAutocomplete";

interface TeamRegisterDialogProps {
    event: EventData;
    user: User;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

interface UserProfile {
    uid: string;
    displayName: string;
    email: string;
    photoURL?: string;
    redflagged?: boolean;
}

export function TeamRegisterDialog({
    event,
    user,
    trigger,
    onSuccess,
    open: controlledOpen,
    onOpenChange: setControlledOpen,
}: TeamRegisterDialogProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = isControlled ? setControlledOpen : setInternalOpen;

    const [mode, setMode] = useState<"SELECT" | "PARTNER" | "SINGLE">("SELECT");
    const { showToast } = useToast();

    // Hook integration with atomic server service
    const { registerSolo, sendInvite, loading: teamLoading } = useTeamRegistration();
    const isSubmittingRef = useRef(false);

    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isInviting, setIsInviting] = useState(false);
    const [invitingPartnerName, setInvitingPartnerName] = useState<string | null>(null);

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setAgreedToTerms(false);
            setMode("SELECT");
            setErrorMessage(null);
        }
    }, [open]);

    // Helper: Sync Auth Data to Firestore
    const ensureProfileSynced = async () => {
        if (!user) return null;

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("uid", "==", user.uid));
            const querySnapshot = await getDocs(q);

            let profileRef;
            let userProfile: DocumentData = {};

            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                userProfile = docSnap.data();
                profileRef = docSnap.ref;
            } else {
                profileRef = doc(db, "users", user.uid);
                userProfile = {
                    uid: user.uid,
                    email: user.email,
                    createdAt: Timestamp.now(),
                };
            }

            const updates: Record<string, string | number | boolean | Timestamp | null | undefined> = {};
            let needsUpdate = false;

            if (user.emailVerified && !userProfile.emailVerified && !userProfile.is_email_verified) {
                updates.emailVerified = true;
                userProfile.emailVerified = true;
                needsUpdate = true;
            }

            if (!userProfile.displayName && !userProfile.fullName && user.displayName) {
                updates.displayName = user.displayName;
                updates.fullName = user.displayName;
                userProfile.displayName = user.displayName;
                needsUpdate = true;
            }

            if (!userProfile.photoUrl && !userProfile.photoURL && user.photoURL) {
                updates.photoUrl = user.photoURL;
                userProfile.photoUrl = user.photoURL;
                needsUpdate = true;
            }

            if (needsUpdate || querySnapshot.empty) {
                if (querySnapshot.empty) {
                    await setDoc(profileRef, { ...userProfile, ...updates });
                } else {
                    await updateDoc(profileRef, updates);
                }
            }
            return userProfile;
        } catch (e) {
            console.error("Profile Sync Error:", e);
            return {
                displayName: user.displayName,
                photoUrl: user.photoURL,
                uid: user.uid,
            };
        }
    };

    const handleInvitePartner = async (partner: UserProfile) => {
        if (!user || isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsInviting(true);
        setInvitingPartnerName(partner.displayName);
        setErrorMessage(null);

        try {
            const syncedProfile = await ensureProfileSynced();

            // Check eligibility (email verification & phone number)
            const eligibility = await checkPlayerEligibility(user, syncedProfile);
            if (!eligibility.eligible) {
                setErrorMessage(eligibility.message);
                showToast(eligibility.message, "error");
                return;
            }

            // Check red flag
            if (syncedProfile?.redflagged) {
                const msg = "Your account is currently red-flagged.";
                setErrorMessage(msg);
                showToast(msg, "error");
                return;
            }

            await sendInvite(event.eventId, partner.uid);
            showToast(`Invitation sent to ${partner.displayName}!`, "success");
            if (setOpen) setOpen(false);
            if (onSuccess) onSuccess();
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Failed to send invite";
            setErrorMessage(msg);
            showToast(msg, "error");
        } finally {
            isSubmittingRef.current = false;
            setIsInviting(false);
            setInvitingPartnerName(null);
        }
    };

    const handleRegisterSingle = async () => {
        if (!user || isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setErrorMessage(null);

        try {
            const profile = await ensureProfileSynced();

            // Check eligibility (email verification & phone number)
            const eligibility = await checkPlayerEligibility(user, profile);
            if (!eligibility.eligible) {
                setErrorMessage(eligibility.message);
                showToast(eligibility.message, "error");
                return;
            }

            // Check red flag
            if (profile?.redflagged) {
                const msg = "Your account is currently red-flagged.";
                setErrorMessage(msg);
                showToast(msg, "error");
                return;
            }

            // Call atomic server solo registration (SC-01 / SC-22)
            await registerSolo(event.eventId);

            showToast("Registered as Free Agent!", "success");
            if (onSuccess) onSuccess();
            if (setOpen) setOpen(false);
        } catch (error) {
            const msg = error instanceof Error ? error.message : "Failed to register";
            setErrorMessage(msg);
            showToast(msg, "error");
        } finally {
            isSubmittingRef.current = false;
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || <Button>{t("Register Team")}</Button>}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{t("Team Registration")}</DialogTitle>
                    <DialogDescription>
                        {t("Choose how you want to join")} {event.eventName}
                    </DialogDescription>
                </DialogHeader>

                {errorMessage && (
                    <div className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span className="flex-1">{errorMessage}</span>
                    </div>
                )}

                {mode === "SELECT" && (
                    <div className="grid gap-4 py-4">
                        <Button
                            variant="outline"
                            className="h-24 flex flex-col items-center justify-center gap-2 hover:bg-blue-50 hover:border-blue-200 transition-all disabled:opacity-50"
                            onClick={() => setMode("PARTNER")}
                            disabled={!agreedToTerms}
                        >
                            <UserPlus className="h-8 w-8 text-blue-600" />
                            <span className="font-semibold">{t("I have a partner")}</span>
                            <span className="text-xs text-gray-500 font-normal">{t("Invite a friend to play with you")}</span>
                        </Button>
                        <Button
                            variant="outline"
                            className="h-24 flex flex-col items-center justify-center gap-2 hover:bg-green-50 hover:border-green-200 transition-all disabled:opacity-50"
                            onClick={() => handleRegisterSingle()}
                            disabled={teamLoading || !agreedToTerms}
                        >
                            {teamLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : <UserIcon className="h-8 w-8 text-green-600" />}
                            <span className="font-semibold">{t("Find me a partner")}</span>
                            <span className="text-xs text-gray-500 font-normal">{t('Join the "Free Agents" list')}</span>
                        </Button>
                    </div>
                )}

                {mode === "PARTNER" && (
                    <div className="space-y-4 py-3">
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                {t("Invite Partner")}
                            </label>
                            <PlayerSearchAutocomplete
                                eventId={event.eventId}
                                currentUserId={user?.uid}
                                disabled={!agreedToTerms || teamLoading || isInviting}
                                onSelectPlayer={(partner) => handleInvitePartner(partner)}
                                actionLabel={t("Invite")}
                                placeholder={t("Search by name or email...")}
                                isSubmitting={teamLoading || isInviting}
                            />
                        </div>

                        {isInviting && (
                            <div className="flex items-center justify-center gap-2 py-2 px-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-600 dark:text-orange-400 text-xs font-medium animate-pulse">
                                <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                                <span>Sending invitation{invitingPartnerName ? ` to ${invitingPartnerName}` : ""}...</span>
                            </div>
                        )}

                        <Button variant="ghost" size="sm" onClick={() => setMode("SELECT")} disabled={isInviting || teamLoading} className="w-full">
                            {t("Back")}
                        </Button>
                    </div>
                )}

                {/* T&C Checkbox */}
                <div className="pt-3 border-t border-gray-100 flex items-start gap-2.5">
                    <input
                        type="checkbox"
                        id="agree-terms-team"
                        checked={agreedToTerms}
                        onChange={(e) => setAgreedToTerms(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <label htmlFor="agree-terms-team" className="text-xs text-gray-600 leading-normal cursor-pointer select-none">
                        I have read and agree to the{" "}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                setTermsModalOpen(true);
                            }}
                            className="text-orange-600 font-semibold underline hover:text-orange-700"
                        >
                            Event Terms & Conditions
                        </button>{" "}
                        and cancellation policy.
                    </label>
                </div>

                <EventTermsModal event={event} open={termsModalOpen} onOpenChange={setTermsModalOpen} />
            </DialogContent>
        </Dialog>
    );
}
