"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { db } from "@/lib/firebase";
import { doc, runTransaction, Timestamp, collection, query, where, getDocs } from "firebase/firestore";
import { EventData } from "./EventCard";

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
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();
    const handleAccept = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            // 1. Find existing registrations (OUTSIDE Transaction)
            const registrationsRef = collection(db, "registrations");

            // Requester Registration
            const reqQuery = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("playerId", "==", requester.uid)
            );
            const reqSnapshot = await getDocs(reqQuery);
            const requesterRegId = !reqSnapshot.empty ? reqSnapshot.docs[0].id : null;

            // Current User Registration
            const curQuery = query(
                registrationsRef,
                where("eventId", "==", event.eventId),
                where("playerId", "==", currentUser.uid)
            );
            const curSnapshot = await getDocs(curQuery);
            const currentUserRegId = !curSnapshot.empty ? curSnapshot.docs[0].id : null;

            await runTransaction(db, async (transaction) => {
                if (!event.eventId) throw new Error("Invalid event data: Missing event ID");
                const eventRef = doc(db, "events", event.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (!eventDoc.exists()) throw new Error("Event does not exist");

                const currentEventData = eventDoc.data();
                const currentCount = currentEventData.registrationsCount || 0;
                const slotsAvailable = currentEventData.slotsAvailable;


                if (currentCount + 1 > slotsAvailable) {

                }

                // 1. Update Team Status
                const teamRef = doc(db, "teams", notification.teamId);
                const teamDoc = await transaction.get(teamRef);
                if (!teamDoc.exists()) throw new Error("Team not found");

                const teamData = teamDoc.data();
                if (teamData.status === 'CONFIRMED') {
                    throw new Error("This invite has already been accepted.");
                }

                transaction.update(teamRef, {
                    player2Confirmed: true,
                    status: "CONFIRMED",
                    fullNameP2: currentUser.displayName || "Unknown Player",
                    teamId: notification.teamId
                });

                // 2. Update/Create Registrations
                // Requester
                if (requesterRegId) {
                    const reqRegRef = doc(db, "registrations", requesterRegId);
                    transaction.update(reqRegRef, {
                        status: "CONFIRMED",
                        teamId: notification.teamId,
                        partnerStatus: "CONFIRMED",
                        isPrimary: true,
                        _debugSource: "PartnerResponseDialog.tsx - handleAccept (2. Update/Create Registrations) - Requester",
                    });
                } //else {
                // Fallback: Create if not exists (shouldn't happen for initiator)
                // const newReqRegRef = doc(collection(db, "registrations"));
                //transaction.set(newReqRegRef, {
                //    registrationId: newReqRegRef.id,
                //    eventId: event.eventId,
                //    playerId: requester.uid,
                //    registeredAt: Timestamp.now(),
                //     status: "CONFIRMED",
                //    isPrimary: true,
                //   teamId: notification.teamId,
                //     partnerStatus: "CONFIRMED",
                //    _debugSource: "PartnerResponseDialog.tsx - handleAccept (CREATE) - Requester",
                // });
                //  }

                // Current User (Partner)
                if (currentUserRegId) {
                    const curRegRef = doc(db, "registrations", currentUserRegId);
                    transaction.update(curRegRef, {
                        status: "CONFIRMED",
                        teamId: notification.teamId,
                        partnerStatus: "CONFIRMED",
                        isPrimary: false,
                        fullNameP2: requester.displayName || "Unknown Player",
                        _debugSource: "PartnerResponseDialog.tsx - handleAccept - Partner"
                    });
                }//else {
                //const newCurRegRef = doc(collection(db, "registrations"));
                //transaction.set(newCurRegRef, {
                //   registrationId: newCurRegRef.id,
                //   eventId: event.eventId,
                //   playerId: currentUser.uid,
                //  registeredAt: Timestamp.now(),
                //  status: "CONFIRMED",
                //  isPrimary: false,
                //  teamId: notification.teamId,
                //   partnerStatus: "CONFIRMED",
                //   _debugSource: "PartnerResponseDialog.tsx - handleAccept (Create)- Partner"
                // });
                //  }

                // 3. Update Event Count
                transaction.update(eventRef, {
                    registrationsCount: currentCount + 1
                });

                // 4. Update Notification (Mark as handled/read)
                if (notification.notificationId && notification.notificationId !== 'from_url') {
                    const notifRef = doc(db, "notifications", notification.notificationId);
                    transaction.update(notifRef, { read: true });
                }

                // 5. Notify Requester
                const replyNotifRef = doc(collection(db, "notifications"));
                transaction.set(replyNotifRef, {
                    notificationId: replyNotifRef.id,
                    userId: requester.uid,
                    type: "partner_accepted",
                    title: "Partner Accepted",
                    message: `${currentUser.displayName || "Your partner"} accepted your team invite for ${event.eventName}!`,
                    fromUserId: currentUser.uid,
                    eventId: event.eventId,
                    teamId: notification.teamId,
                    read: false,
                    createdAt: Timestamp.now()
                });
            });

            showToast("Team confirmed! You are now registered.", "success");
            onOpenChange(false);
            if (onSuccess) onSuccess();

        } catch (error) {
            console.error("Accept error:", error);
            const message = error instanceof Error ? error.message : "Failed to accept invite";
            showToast(message, "error");
        } finally {
            setLoading(false);
        }
    };

    const handleDecline = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            await runTransaction(db, async (transaction) => {
                // 1. Delete/Update Team
                const teamRef = doc(db, "teams", notification.teamId);
                transaction.delete(teamRef); // Or set status to DENIED

                // 2. Update Notification
                // 2. Update Notification
                if (notification.notificationId && notification.notificationId !== 'from_url') {
                    const notifRef = doc(db, "notifications", notification.notificationId);
                    transaction.update(notifRef, { read: true });
                }

                // 3. Notify Requester
                const replyNotifRef = doc(collection(db, "notifications"));
                transaction.set(replyNotifRef, {
                    notificationId: replyNotifRef.id,
                    userId: requester.uid,
                    type: "partner_declined",
                    title: "Partner Declined",
                    message: `${currentUser.displayName || "Your partner"} declined your team invite.`,
                    fromUserId: currentUser.uid,
                    eventId: event.eventId,
                    read: false,
                    createdAt: Timestamp.now()
                });
            });

            showToast("Invite declined.", "info");
            onOpenChange(false);
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error("Decline error:", error);
            showToast("Failed to decline invite", "error");
        } finally {
            setLoading(false);
        }
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
