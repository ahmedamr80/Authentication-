"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { EventData } from "./EventCard";
import { useTeamRegistration } from "@/hooks/useTeamRegistration";
import { db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";

interface PartnerResponseDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    notification: { teamId: string; notificationId: string; type?: string };
    event: EventData;
    requester: { uid: string; displayName?: string };
    currentUser: { uid: string; displayName?: string | null; photoURL?: string | null } | null;
    isReplacement?: boolean;
    onSuccess?: () => void;
}

export function PartnerResponseDialog({
    open,
    onOpenChange,
    notification,
    event,
    requester,
    currentUser,
    isReplacement = false,
    onSuccess,
}: PartnerResponseDialogProps) {
    const { acceptInvite, rejectInvite, acceptReplacement, loading } = useTeamRegistration();
    const { showToast } = useToast();

    const handleAccept = async () => {
        if (!currentUser) return;

        try {
            if (isReplacement || notification.type === "REPLACEMENT_INVITE") {
                await acceptReplacement(notification.teamId);
                showToast("Replacement confirmed! You are now on the team.", "success");
            } else {
                const res = await acceptInvite(notification.teamId);
                const isWaitlist = res?.status === "WAITLIST";
                showToast(
                    isWaitlist ? "Added to the waitlist!" : "Team confirmed! You are now registered.",
                    "success"
                );
            }

            // Mark notification read if available
            if (notification.notificationId && notification.notificationId !== "from_url") {
                try {
                    await updateDoc(doc(db, "notifications", notification.notificationId), { read: true });
                } catch {
                    // Non-blocking
                }
            }

            onOpenChange(false);
            onSuccess?.();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to accept invite", "error");
        }
    };

    const handleDecline = async () => {
        if (!currentUser) return;

        try {
            await rejectInvite(notification.teamId);
            showToast("Invite declined.", "info");

            // Mark notification read
            if (notification.notificationId && notification.notificationId !== "from_url") {
                try {
                    await updateDoc(doc(db, "notifications", notification.notificationId), { read: true });
                } catch {
                    // Non-blocking
                }
            }

            onOpenChange(false);
            onSuccess?.();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to decline invite", "error");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-gray-950 border border-gray-800 text-white">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-white">
                        {isReplacement || notification.type === "REPLACEMENT_INVITE"
                            ? "Replacement Team Invite"
                            : "Team Invitation"}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        {requester?.displayName} wants to team up with you for {event.eventName}.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-2">
                    <p className="text-sm text-gray-300">
                        <strong>Event:</strong> {event.eventName} <br />
                        <strong>Date:</strong> {event.dateTime?.toDate?.() ? event.dateTime.toDate().toLocaleDateString() : "TBD"} <br />
                        <strong>Location:</strong> {event.locationName || (event as unknown as { location?: string }).location || "TBD"}
                    </p>
                    <p className="text-xs text-gray-400">
                        {isReplacement || notification.type === "REPLACEMENT_INVITE"
                            ? "Accepting this will fill the vacant spot in this confirmed team."
                            : "Accepting this invite will register both of you for the event as a team."}
                    </p>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={handleDecline}
                        disabled={loading}
                        className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Decline"}
                    </Button>
                    <Button
                        onClick={handleAccept}
                        disabled={loading}
                        className="bg-green-600 hover:bg-green-700 text-white font-medium"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept & Join"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}