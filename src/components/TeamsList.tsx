"use client";

import { useState, useMemo, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Check, LogOut, Hourglass, UserPlus, AlertCircle } from "lucide-react";
import Link from "next/link";
import { User } from "firebase/auth";
import { useToast } from "@/context/ToastContext";
import { useTeamRegistration } from "@/hooks/useTeamRegistration";
import { Team } from "@/types";
export type { Team };
import { ReplacementInviteDialog } from "@/components/ReplacementInviteDialog";
import { LateWithdrawalWarningDialog } from "@/components/LateWithdrawalWarningDialog";
import { getTimestampMillis } from "@/lib/date-utils";

function GraceCountdownBadge({ deadline, onExpire }: { deadline: any; onExpire?: () => void }) {
    const [timeLeft, setTimeLeft] = useState<string>("");

    useEffect(() => {
        const deadlineMs = getTimestampMillis(deadline);
        if (!deadlineMs) {
            setTimeLeft("5m 00s left");
            return;
        }

        const update = () => {
            const diff = deadlineMs - Date.now();
            if (diff <= 0) {
                setTimeLeft("Grace Expired");
                onExpire?.();
            } else {
                const mins = Math.floor(diff / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${mins}m ${secs < 10 ? "0" : ""}${secs}s left`);
            }
        };

        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [deadline, onExpire]);

    return (
        <Badge
            variant="outline"
            className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px] font-mono flex items-center gap-1"
        >
            <Clock className="w-2.5 h-2.5 animate-spin" style={{ animationDuration: "3s" }} />
            {timeLeft || "5-Minute Grace Active"}
        </Badge>
    );
}

interface TeamsListProps {
    currentUser: User | null;
    teams: Team[];
    loading: boolean;
    onManageInvite?: (team: Team) => void;
    onRefresh?: () => void;
}

export function TeamsList({ currentUser, teams, loading, onManageInvite, onRefresh }: TeamsListProps) {
    const { showToast } = useToast();
    const { cancelInvite, withdraw, loading: actionLoading } = useTeamRegistration();

    // Dialog states
    const [replacementTeam, setReplacementTeam] = useState<Team | null>(null);
    const [isReplacementOpen, setIsReplacementOpen] = useState(false);

    const [isLateWarningOpen, setIsLateWarningOpen] = useState(false);
    const [lateWarningTeam, setLateWarningTeam] = useState<Team | null>(null);
    const [lateWarningMessage, setLateWarningMessage] = useState<string | undefined>(undefined);

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500"></div>
            </div>
        );
    }

    const handleLeaveTeam = async (team: Team) => {
        if (!currentUser) return;

        try {
            const res = await withdraw(team.eventId, false);
            if (res.requiresConfirmation) {
                // Open Late Withdrawal Warning Dialog (SC-15)
                setLateWarningTeam(team);
                setLateWarningMessage(res.warningMessage);
                setIsLateWarningOpen(true);
                return;
            }

            if (res.success) {
                showToast("You have withdrawn from the team.", "success");
                onRefresh?.();
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to leave team", "error");
        }
    };

    const handleConfirmLateWithdrawal = async () => {
        if (!lateWarningTeam || !currentUser) return;
        try {
            const res = await withdraw(lateWarningTeam.eventId, true);
            if (res.success) {
                showToast("Late withdrawal confirmed. Your account is red-flagged.", "warning");
                setIsLateWarningOpen(false);
                setLateWarningTeam(null);
                onRefresh?.();
            }
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to withdraw", "error");
        }
    };

    const handleCancelInvitation = async (teamId: string) => {
        if (!currentUser) return;
        if (!confirm("Cancel this invitation? You will remain registered as a Free Agent.")) return;

        try {
            await cancelInvite(teamId);
            showToast("Invitation cancelled. You remain a Free Agent.", "success");
            onRefresh?.();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to cancel invitation", "error");
        }
    };

    const handleOpenReplacementDialog = (team: Team) => {
        setReplacementTeam(team);
        setIsReplacementOpen(true);
    };

    // Filter and sort teams by time in ascending order
    const confirmedTeams = useMemo(() => {
        return teams
            .filter((t) => t.status === "CONFIRMED")
            .sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));
    }, [teams]);

    const graceTeams = useMemo(() => {
        return teams
            .filter((t) => t.status === "REPLACEMENT_GRACE")
            .sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));
    }, [teams]);

    const waitlistTeams = useMemo(() => {
        return teams
            .filter((t) => t.status === "WAITLIST")
            .sort((a, b) => {
                const seqA = a.waitlistSequence;
                const seqB = b.waitlistSequence;
                if (typeof seqA === "number" && typeof seqB === "number" && seqA !== seqB) {
                    return seqA - seqB;
                }
                return getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt);
            });
    }, [teams]);

    const pendingTeams = useMemo(() => {
        return teams
            .filter((t) => t.status === "PENDING")
            .sort((a, b) => getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt));
    }, [teams]);

    return (
        <div className="space-y-8">
            {/* Confirmed Teams Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span className="bg-green-500/10 text-green-500 p-1 rounded">
                        <Check className="w-4 h-4" />
                    </span>
                    Confirmed Teams ({confirmedTeams.length})
                </h3>

                {confirmedTeams.length === 0 ? (
                    <div className="text-center py-8 bg-gray-900/50 rounded-xl border border-gray-800 border-dashed">
                        <p className="text-gray-500">No confirmed teams yet</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {confirmedTeams.map((team) => (
                            <div
                                key={team.teamId}
                                className="bg-gray-900/80 backdrop-blur-sm border border-green-500/30 rounded-xl p-3 sm:p-4 hover:border-green-500/50 transition-colors relative group"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                        <div className="flex items-center -space-x-2 sm:-space-x-3 shrink-0">
                                            <Link href={`/community/${team.player1Id}`}>
                                                <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border-2 border-gray-900 z-10 cursor-pointer hover:ring-2 hover:ring-orange-500 transition-all">
                                                    <AvatarImage src={team.player1?.photoURL || team.player1?.photoUrl} />
                                                    <AvatarFallback className="bg-gray-800 text-gray-400 text-xs sm:text-sm">
                                                        {team.player1?.displayName?.charAt(0) || "?"}
                                                    </AvatarFallback>
                                                </Avatar>
                                            </Link>
                                            <Link href={`/community/${team.player2Id}`}>
                                                <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border-2 border-gray-900 cursor-pointer hover:ring-2 hover:ring-orange-500 transition-all">
                                                    <AvatarImage src={team.player2?.photoURL || team.player2?.photoUrl} />
                                                    <AvatarFallback className="bg-gray-800 text-gray-400 text-xs sm:text-sm">
                                                        {team.player2?.displayName?.charAt(0) || "?"}
                                                    </AvatarFallback>
                                                </Avatar>
                                            </Link>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-white truncate">
                                                <Link href={`/community/${team.player1Id}`} className="hover:text-orange-400 transition-colors">
                                                    {team.player1?.displayName || team.fullNameP1 || "Player 1"}
                                                </Link>{" "}
                                                &{" "}
                                                <Link href={`/community/${team.player2Id}`} className="hover:text-orange-400 transition-colors">
                                                    {team.player2?.displayName || team.fullNameP2 || "Player 2"}
                                                </Link>
                                            </p>
                                        </div>
                                    </div>

                                    <Badge className="bg-green-600 hover:bg-green-600 text-white border-0 flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 shrink-0">
                                        <Check className="w-3 h-3" />
                                        <span className="hidden sm:inline">Confirmed</span>
                                    </Badge>
                                </div>

                                {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-gray-400 hover:text-red-400 hover:bg-red-400/10"
                                            onClick={() => handleLeaveTeam(team)}
                                            disabled={actionLoading}
                                            title="Leave Team"
                                        >
                                            <LogOut className="h-3 w-3" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Replacement Grace Teams Section (SC-09, SC-10, SC-13) */}
            {graceTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-amber-400 flex items-center gap-2">
                        <span className="bg-amber-500/10 text-amber-500 p-1 rounded">
                            <Clock className="w-4 h-4" />
                        </span>
                        Teams in Replacement Grace ({graceTeams.length})
                    </h3>

                    <div className="space-y-3">
                        {graceTeams.map((team) => {
                            const isRemainingP1 = team.vacantSlot === "PLAYER2";
                            const remainingPlayer = isRemainingP1 ? team.player1 : team.player2;
                            const isCurrentUserRemaining =
                                currentUser &&
                                (isRemainingP1 ? team.player1Id === currentUser.uid : team.player2Id === currentUser.uid);

                            return (
                                <div
                                    key={team.teamId}
                                    className="bg-gray-950 border border-amber-500/40 rounded-xl p-4 relative group"
                                >
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center -space-x-3">
                                                <Avatar className="h-10 w-10 border-2 border-gray-900 z-10">
                                                    <AvatarImage src={remainingPlayer?.photoURL || remainingPlayer?.photoUrl} />
                                                    <AvatarFallback className="bg-gray-800 text-gray-300">
                                                        {remainingPlayer?.displayName?.charAt(0) || "?"}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="h-10 w-10 border-2 border-dashed border-amber-500/60 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 text-xs font-bold">
                                                    ?
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">
                                                    {remainingPlayer?.displayName || "Player"} (Waiting for replacement)
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <GraceCountdownBadge
                                                        deadline={team.replacementDeadlineAt}
                                                        onExpire={() => {
                                                            fetch("/api/events/teams/check-expiry", {
                                                                method: "POST",
                                                                headers: { "Content-Type": "application/json" },
                                                                body: JSON.stringify({ teamId: team.teamId, eventId: team.eventId }),
                                                            }).catch(() => {});
                                                        }}
                                                    />
                                                    <span className="text-xs text-gray-500">Slot reserved</span>
                                                </div>
                                            </div>
                                        </div>

                                        {isCurrentUserRemaining && (
                                            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleOpenReplacementDialog(team)}
                                                    className="bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs h-8"
                                                >
                                                    <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                                                    Invite Replacement
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleLeaveTeam(team)}
                                                    disabled={actionLoading}
                                                    className="h-8 w-8 text-gray-500 hover:text-red-400"
                                                    title="Withdraw"
                                                >
                                                    <LogOut className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Waitlist Teams Section (SC-29 FIFO) */}
            {waitlistTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-orange-500/10 text-orange-500 p-1 rounded">
                            <Hourglass className="w-4 h-4" />
                        </span>
                        Waitlist Teams ({waitlistTeams.length})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {waitlistTeams.map((team, idx) => (
                            <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 border-dashed rounded-xl p-4 relative group">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center -space-x-3">
                                            <Avatar className="h-10 w-10 border-2 border-gray-950 z-10 grayscale opacity-80">
                                                <AvatarImage src={team.player1?.photoURL || team.player1?.photoUrl} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400">
                                                    {team.player1?.displayName?.charAt(0) || "?"}
                                                </AvatarFallback>
                                            </Avatar>
                                            <Avatar className="h-10 w-10 border-2 border-gray-950 grayscale opacity-80">
                                                <AvatarImage src={team.player2?.photoURL || team.player2?.photoUrl} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400">
                                                    {team.player2?.displayName?.charAt(0) || "?"}
                                                </AvatarFallback>
                                            </Avatar>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-300">
                                                {team.player1?.displayName || team.fullNameP1 || "Player 1"} &{" "}
                                                {team.player2?.displayName || team.fullNameP2 || "Player 2"}
                                            </p>
                                            <Badge variant="outline" className="mt-1 bg-orange-500/10 text-orange-500 border-orange-500/20 text-[10px] h-5">
                                                Waitlist #{idx + 1}
                                            </Badge>
                                        </div>
                                    </div>

                                    {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-red-400/10"
                                            onClick={() => handleLeaveTeam(team)}
                                            disabled={actionLoading}
                                            title="Withdraw from Waitlist"
                                        >
                                            <LogOut className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Pending Teams Section (SC-03, SC-05) */}
            {pendingTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-yellow-500/10 text-yellow-500 p-1 rounded">
                            <Clock className="w-4 h-4" />
                        </span>
                        Pending Invitations ({pendingTeams.length})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingTeams.map((team) => {
                            const isInvitedUser = currentUser && team.player2Id === currentUser.uid;
                            const isCaptain = currentUser && team.player1Id === currentUser.uid;

                            return (
                                <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 border-dashed rounded-xl p-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center -space-x-3">
                                                <Avatar className="h-10 w-10 border-2 border-gray-800 z-10">
                                                    <AvatarImage src={team.player1?.photoURL || team.player1?.photoUrl} />
                                                    <AvatarFallback>{team.player1?.displayName?.charAt(0) || "P1"}</AvatarFallback>
                                                </Avatar>
                                                <Avatar className="h-10 w-10 border-2 border-gray-800 opacity-50 grayscale">
                                                    <AvatarImage src={team.player2?.photoURL || team.player2?.photoUrl} />
                                                    <AvatarFallback>{team.player2?.displayName?.charAt(0) || "P2"}</AvatarFallback>
                                                </Avatar>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">
                                                    {team.player1?.displayName || team.fullNameP1 || "Inviter"}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {isInvitedUser
                                                        ? "Invited you to team up"
                                                        : `Invited ${team.player2?.displayName || team.fullNameP2 || "Partner"}`}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                                            Pending
                                        </Badge>
                                    </div>

                                    {isInvitedUser && (
                                        <Button
                                            className="w-full bg-green-600 hover:bg-green-700 h-8 text-xs font-semibold"
                                            onClick={() => onManageInvite?.(team)}
                                        >
                                            <Check className="w-3.5 h-3.5 mr-1" />
                                            Respond to Invitation
                                        </Button>
                                    )}

                                    {isCaptain && (
                                        <div className="mt-2">
                                            <p className="text-xs text-gray-500 text-center italic">
                                                Waiting for partner to accept...
                                            </p>
                                            <Button
                                                variant="ghost"
                                                className="w-full mt-2 h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                                onClick={() => handleCancelInvitation(team.teamId)}
                                                disabled={actionLoading}
                                            >
                                                Cancel Invitation
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Replacement Invite Modal */}
            <ReplacementInviteDialog
                open={isReplacementOpen}
                onOpenChange={setIsReplacementOpen}
                team={replacementTeam}
                currentUserId={currentUser?.uid || ""}
                onSuccess={() => onRefresh?.()}
            />

            {/* Late Withdrawal Warning Modal (SC-15) */}
            <LateWithdrawalWarningDialog
                open={isLateWarningOpen}
                onOpenChange={setIsLateWarningOpen}
                onConfirm={handleConfirmLateWithdrawal}
                loading={actionLoading}
                warningMessage={lateWarningMessage}
            />
        </div>
    );
}
