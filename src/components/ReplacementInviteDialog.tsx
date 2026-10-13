"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UserPlus, XCircle } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useTeamRegistration } from "@/hooks/useTeamRegistration";
import { Team } from "@/types";
import { PlayerSearchAutocomplete } from "@/components/PlayerSearchAutocomplete";

interface UserProfile {
    uid: string;
    displayName: string;
    email: string;
    photoURL?: string;
}

interface ReplacementInviteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    team: Team | null;
    currentUserId: string;
    onSuccess?: () => void;
}

export function ReplacementInviteDialog({
    open,
    onOpenChange,
    team,
    currentUserId,
    onSuccess,
}: ReplacementInviteDialogProps) {
    const { showToast } = useToast();
    const { inviteReplacement, cancelReplacementInvite, loading } = useTeamRegistration();

    const handleSendInvite = async (candidate: { uid: string; displayName: string }) => {
        if (!team) return;
        try {
            await inviteReplacement(team.teamId, candidate.uid);
            showToast(`Replacement invitation sent to ${candidate.displayName}!`, "success");
            onOpenChange(false);
            onSuccess?.();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to invite candidate", "error");
        }
    };

    const handleCancelActiveInvite = async () => {
        if (!team) return;
        try {
            await cancelReplacementInvite(team.teamId);
            showToast("Replacement invitation cancelled.", "info");
            onOpenChange(false);
            onSuccess?.();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to cancel invitation", "error");
        }
    };

    const hasActiveCandidate = !!team?.replacementCandidateId;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[450px] bg-gray-950 border border-gray-800 text-white">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
                        <UserPlus className="w-5 h-5 text-orange-500" />
                        Invite Replacement Partner
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-sm">
                        You are in a 5-minute replacement grace period. Invite a partner to keep your confirmed team slot.
                    </DialogDescription>
                </DialogHeader>

                {hasActiveCandidate && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between">
                        <div className="text-xs text-amber-300">
                            You currently have an active replacement invitation pending.
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleCancelActiveInvite}
                            disabled={loading}
                            className="text-xs h-7"
                        >
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Cancel
                        </Button>
                    </div>
                )}

                <div className="space-y-4 py-2">
                    <PlayerSearchAutocomplete
                        eventId={team?.eventId}
                        currentUserId={currentUserId}
                        excludeUids={team?.player1Id ? [team.player1Id] : []}
                        theme="dark"
                        disabled={loading || hasActiveCandidate}
                        onSelectPlayer={(candidate) => handleSendInvite(candidate)}
                        placeholder="Search by player name or email..."
                        actionLabel="Invite"
                        isSubmitting={loading}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
