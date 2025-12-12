"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { EventData } from "./EventCard";
import { useTeamAccept } from "@/hooks/useTeamAccept";
import { useTeamDissolve } from "@/hooks/useTeamDissolve";
import { User } from "firebase/auth";

interface PartnerResponseDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    notification: { teamId: string; notificationId: string };
    event: EventData;
    requester: { uid: string; displayName?: string };
    currentUser: { uid: string; displayName?: string | null; photoURL?: string | null } | null;
    onSuccess?: () => void;
}

export function PartnerResponseDialog({
    open,
    onOpenChange,
    notification,
    event,
    requester,
    currentUser,
    onSuccess
}: PartnerResponseDialogProps) {
    const { acceptInvite, loading: acceptLoading } = useTeamAccept();
    const { dissolveTeam, loading: declineLoading } = useTeamDissolve();
    const { showToast } = useToast();
    const loading = acceptLoading || declineLoading;

    const handleAccept = async () => {
        if (!currentUser) return;

        await acceptInvite(
            currentUser as User, // Explicit cast to User type instead of 'any'
            notification.teamId,
            notification.notificationId,
            () => {
                showToast("Team confirmed! You are now registered.", "success");
                onOpenChange(false);
                if (onSuccess) onSuccess();
            }
        );
    };

    const handleDecline = async () => {
        if (!currentUser) return;

        // Dissolve logic requires currentUser to include displayName/photo for notifications
        const dissolveUser = {
            uid: currentUser.uid,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL
        };

        await dissolveTeam(
            dissolveUser,
            notification.teamId,
            event.eventId,
            "DECLINE",
            notification.notificationId,
            () => {
                showToast("Invite declined.", "info");
                onOpenChange(false);
                if (onSuccess) onSuccess();
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Team Invite</DialogTitle>
                    <DialogDescription>
                        {requester?.displayName} wants to team up with you for {event.eventName}.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-2">
                    <p className="text-sm">
                        <strong>Event:</strong> {event.eventName} <br />
                        <strong>Date:</strong> {event.dateTime.toDate().toLocaleDateString()} <br />
                        <strong>Location:</strong> {event.locationName}
                    </p>
                    <p className="text-sm text-gray-500">
                        Accepting this invite will register both of you for the event as a team.
                    </p>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={handleDecline} disabled={loading} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Decline"}
                    </Button>
                    <Button onClick={handleAccept} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept & Join"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}