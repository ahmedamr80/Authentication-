import { useState, useMemo } from "react";
import { EventData, Registration } from "@/lib/types";
import { User } from "firebase/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, Hand, MapPin } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/context/ToastContext";
import { useTeamRegistration } from "@/hooks/useTeamRegistration";
import { Team } from "@/types";
import { getTimestampMillis } from "@/lib/date-utils";

export interface SinglePlayer {
    registrationId: string;
    playerId: string;
    displayName: string;
    photoURL?: string;
    photoUrl?: string;
    lookingForPartner: boolean;
    playerHand?: string;
    playerPosition?: string;
    playerSkillLevel?: string;
    partnerStatus?: string;
    waitlistPosition?: number | null;
    waitlistSequence?: number | null;
    status?: string;
    registeredAt?: any;
}

export interface SinglePlayersListProps {
    event: EventData | null;
    currentUser: User | null;
    userRegistration?: Registration | null;
    players: SinglePlayer[];
    teams?: Team[];
    loading: boolean;
    onManageInvite?: (team: Team) => void;
    onRefresh?: () => void;
}

export function SinglePlayersList({
    event,
    currentUser,
    userRegistration,
    players,
    teams = [],
    loading,
    onManageInvite,
    onRefresh,
}: SinglePlayersListProps) {
    const { showToast } = useToast();
    const { sendInvite, cancelInvite, loading: inviteLoading } = useTeamRegistration();
    const [invitingPlayerId, setInvitingPlayerId] = useState<string | null>(null);
    const activeOutgoingInvite = teams.find(
        (t) => t.player1Id === currentUser?.uid && t.status === "PENDING"
    );
    const hasActiveOutgoingInvite = !!activeOutgoingInvite;

    const handleInvite = async (player: SinglePlayer) => {
        if (!currentUser || !event) return;
        if (hasActiveOutgoingInvite) {
            showToast("You already have an active pending invitation. Please cancel it before sending a new one.", "error");
            return;
        }
        setInvitingPlayerId(player.playerId);

        try {
            await sendInvite(event.eventId, player.playerId);
            showToast(`Invitation sent to ${player.displayName}!`, "success");
            onRefresh?.();
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to send invitation", "error");
        } finally {
            setInvitingPlayerId(null);
        }
    };

    const handleCancelInvite = async (team: Team) => {
        if (!currentUser) return;
        try {
            await cancelInvite(team.teamId);
            showToast("Invitation cancelled. You remain a Free Agent.", "success");
            onRefresh?.();
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to cancel invitation", "error");
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    if (players.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-900/50 rounded-xl border border-gray-800 border-dashed">
                <div className="bg-gray-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <UserPlus className="h-8 w-8 text-gray-500" />
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No players registered yet</h3>
                <p className="text-gray-400 max-w-sm mx-auto">
                    Be the first to register to our event!
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {players.map((player) => {
                // Check if there is an existing interaction
                const inviteSent = teams.find(
                    (t) => t.player1Id === currentUser?.uid && t.player2Id === player.playerId && t.status === "PENDING"
                );
                const inviteReceived = teams.find(
                    (t) => t.player1Id === player.playerId && t.player2Id === currentUser?.uid && t.status === "PENDING"
                );

                return (
                    <div
                        key={player.registrationId}
                        className="bg-gray-900/80 backdrop-blur-sm border border-green-500/30 rounded-xl p-4 hover:border-green-500/50 transition-all group relative overflow-hidden"
                    >
                        <div className="flex items-start gap-4">
                            <Link href={`/community/${player.playerId}`}>
                                <Avatar className="h-12 w-12 border-2 border-gray-800 cursor-pointer hover:ring-2 hover:ring-orange-500 transition-all">
                                    <AvatarImage src={player.photoURL || player.photoUrl} />
                                    <AvatarFallback className="bg-gray-800 text-gray-400">
                                        {player.displayName.charAt(0)}
                                    </AvatarFallback>
                                </Avatar>
                            </Link>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                    <Link href={`/community/${player.playerId}`} className="hover:text-orange-400 transition-colors">
                                        <h4 className="text-base font-semibold text-white truncate pr-2 hover:text-orange-400">
                                            {player.displayName}
                                        </h4>
                                    </Link>
                                    {player.playerSkillLevel && (
                                        <Badge variant="secondary" className="bg-gray-800 text-gray-300 text-[10px] h-5">
                                            {player.playerSkillLevel}
                                        </Badge>
                                    )}
                                </div>

                                <div className="flex flex-wrap gap-2 mt-2">
                                    {player.playerPosition && (
                                        <div className="flex items-center text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded">
                                            <MapPin className="w-3 h-3 mr-1 text-orange-500" />
                                            {player.playerPosition}
                                        </div>
                                    )}
                                    {player.playerHand && (
                                        <div className="flex items-center text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded">
                                            <Hand className="w-3 h-3 mr-1 text-blue-400" />
                                            {player.playerHand}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {(() => {
                            const isCurrentUserCommitted = !!(
                                (userRegistration?.teamId && userRegistration?.partnerStatus === "CONFIRMED") ||
                                teams.some(
                                    (t) =>
                                        (t.player1Id === currentUser?.uid || t.player2Id === currentUser?.uid) &&
                                        (t.status === "CONFIRMED" || t.status === "WAITLIST")
                                )
                            );

                            const isPlayerCommitted = !!(
                                (!player.lookingForPartner && (player.status === "CONFIRMED" || player.status === "WAITLIST")) ||
                                teams.some(
                                    (t) =>
                                        (t.player1Id === player.playerId || t.player2Id === player.playerId) &&
                                        (t.status === "CONFIRMED" || t.status === "WAITLIST")
                                )
                            );

                            const totalSpots = event?.slotsAvailable || event?.maxPlayers || 0;
                            const confirmedCount = teams.filter((t) => t.status === "CONFIRMED").length;
                            const isWaitlistInvite = (totalSpots > 0 && confirmedCount >= totalSpots) || (event?.waitlistCount ?? 0) > 0;

                            const canInvite =
                                currentUser &&
                                currentUser.uid !== player.playerId &&
                                event?.unitType === "Teams" &&
                                !isCurrentUserCommitted &&
                                !isPlayerCommitted;

                            if (!canInvite) return null;

                            // If currentUser already initiated an outgoing invite, they cannot invite anyone else.
                            // Only show action on the invited player's card (Cancel) or if an invite was received from this player (Respond).
                            if (hasActiveOutgoingInvite && !inviteSent && !inviteReceived) {
                                return null;
                            }

                            return (
                                <div className="mt-4 pt-4 border-t border-gray-800 flex justify-end">
                                    {inviteSent ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300 text-xs h-8 cursor-pointer"
                                            onClick={() => handleCancelInvite(inviteSent)}
                                            disabled={inviteLoading}
                                        >
                                            Cancel Invitation
                                        </Button>
                                    ) : inviteReceived ? (
                                        <Button
                                            size="sm"
                                            className="bg-green-600 hover:bg-green-700 text-white text-xs h-8"
                                            onClick={() => onManageInvite?.(inviteReceived)}
                                        >
                                            Respond to Invite
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            className={`${
                                                isWaitlistInvite
                                                    ? "bg-amber-600 hover:bg-amber-700"
                                                    : "bg-orange-500 hover:bg-orange-600"
                                            } text-white text-xs h-8`}
                                            onClick={() => handleInvite(player)}
                                            disabled={inviteLoading || invitingPlayerId !== null}
                                        >
                                            {invitingPlayerId === player.playerId ||
                                            (inviteLoading && invitingPlayerId === player.playerId) ? (
                                                <>
                                                    <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                                                    Sending...
                                                </>
                                            ) : (
                                                <>
                                                    <UserPlus className="h-3 w-3 mr-1.5" />
                                                    {isWaitlistInvite ? "Invite to Waitlist Team" : "Invite to Team"}
                                                </>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                );
            })}
        </div>
    );
}
