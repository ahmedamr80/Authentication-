"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Check, LogOut, Hourglass } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { User } from "firebase/auth";
import { useToast } from "@/context/ToastContext";
import { useTeamDissolve } from "@/hooks/useTeamDissolve";

interface TeamMember {
    uid: string;
    displayName: string;
    photoURL?: string;
    skillLevel?: string;
}

export interface Team {
    teamId: string;
    player1Id: string;
    player2Id: string;
    player1Confirmed: boolean;
    player2Confirmed: boolean;
    createdAt: Timestamp;
    eventId: string;
    status: "CONFIRMED" | "PENDING" | "WAITLIST";
    player1?: TeamMember;
    player2?: TeamMember;
}

interface TeamsListProps {
    currentUser: User | null;
    teams: Team[];
    loading: boolean;
    onManageInvite?: (team: Team) => void;
}

export function TeamsList({ currentUser, teams, onManageInvite }: TeamsListProps) {
    const { showToast } = useToast();
    const { dissolveTeam, loading: dissolveLoading } = useTeamDissolve();

    const handleLeaveTeam = async (teamId: string) => {
        if (!currentUser) return;
        if (!confirm("Are you sure you want to leave this team?")) return;

        const team = teams.find(t => t.teamId === teamId);
        if (!team) {
            showToast("Team not found", "error");
            return;
        }

        await dissolveTeam(
            currentUser,
            teamId,
            team.eventId,
            "LEAVE",
            undefined,
            () => {
                showToast("Left team successfully", "success");
            }
        );
    };

    // NEW: Handle Captain Canceling Invitation (Scenario 3)
    const handleCancelInvite = async (teamId: string) => {
        if (!currentUser) return;
        if (!confirm("Cancel this invitation? You will remain registered as a Free Agent.")) return;

        const team = teams.find(t => t.teamId === teamId);
        if (!team) {
            showToast("Team not found", "error");
            return;
        }

        await dissolveTeam(
            currentUser,
            teamId,
            team.eventId,
            "CANCEL", // <--- NEW ACTION: Captain keeps seat, removes partner
            undefined,
            () => {
                showToast("Invitation canceled", "success");
            }
        );
    };

    const confirmedTeams = teams.filter(t => t.status === "CONFIRMED" || (t.player1Confirmed && t.player2Confirmed && t.status !== "WAITLIST"));
    const pendingTeams = teams.filter(t => t.status === "PENDING" || ((!t.player1Confirmed || !t.player2Confirmed) && t.status !== "WAITLIST"));
    const waitlistTeams = teams.filter(t => t.status === "WAITLIST");

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
                            <div key={team.teamId} className="bg-gray-900/80 backdrop-blur-sm border border-green-500/30 rounded-xl p-3 sm:p-4 hover:border-green-500/50 transition-colors relative group">
                                <div className="flex items-center justify-between gap-2">
                                    {/* Left: Overlapping Avatars + Names */}
                                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                        {/* Overlapping Avatars - smaller on mobile */}
                                        <div className="flex items-center -space-x-2 sm:-space-x-3 flex-shrink-0">
                                            <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border-2 border-gray-900 z-10">
                                                <AvatarImage src={team.player1?.photoURL} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400 text-xs sm:text-sm">
                                                    {team.player1?.displayName?.charAt(0) || "?"}
                                                </AvatarFallback>
                                            </Avatar>
                                            <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border-2 border-gray-900">
                                                <AvatarImage src={team.player2?.photoURL} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400 text-xs sm:text-sm">
                                                    {team.player2?.displayName?.charAt(0) || "?"}
                                                </AvatarFallback>
                                            </Avatar>
                                        </div>

                                        {/* Names and Skill Levels - truncate on mobile */}
                                        <div className="min-w-0 flex-1">
                                            {/* Stacked on mobile, inline on larger screens */}
                                            <div className="hidden sm:block">
                                                <p className="text-sm font-medium text-white truncate">
                                                    {team.player1?.displayName || "Unknown"} & {team.player2?.displayName || "Unknown"}
                                                </p>
                                            </div>
                                            <div className="sm:hidden">
                                                <p className="text-xs font-medium text-white truncate">
                                                    {team.player1?.displayName || "Unknown"}
                                                </p>
                                                <p className="text-xs text-gray-400 truncate">
                                                    & {team.player2?.displayName || "Unknown"}
                                                </p>
                                            </div>
                                            <div className="hidden sm:flex items-center gap-2 mt-1">
                                                {team.player1?.skillLevel && (
                                                    <span className="text-xs text-gray-400">{team.player1.skillLevel}</span>
                                                )}
                                                {team.player1?.skillLevel && team.player2?.skillLevel && (
                                                    <span className="text-xs text-gray-600">•</span>
                                                )}
                                                {team.player2?.skillLevel && (
                                                    <span className="text-xs text-gray-400">{team.player2.skillLevel}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Confirmed Badge - icon only on mobile */}
                                    <Badge className="bg-green-600 hover:bg-green-600 text-white border-0 flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 flex-shrink-0">
                                        <Check className="w-3 h-3" />
                                        <span className="hidden sm:inline">Confirmed</span>
                                    </Badge>
                                </div>

                                {/* Leave Team Button (only for members) */}
                                {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-gray-400 hover:text-red-400 hover:bg-red-400/10"
                                            onClick={() => handleLeaveTeam(team.teamId)}
                                            disabled={dissolveLoading}
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

            {/* Waitlist Teams Section */}
            {waitlistTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-orange-500/10 text-orange-500 p-1 rounded">
                            <Hourglass className="w-4 h-4" />
                        </span>
                        Waitlist Teams ({waitlistTeams.length})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {waitlistTeams.map((team) => (
                            <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 border-dashed rounded-xl p-4 relative group">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center -space-x-3">
                                            <Avatar className="h-10 w-10 border-2 border-gray-950 z-10 grayscale opacity-80">
                                                <AvatarImage src={team.player1?.photoURL} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400">
                                                    {team.player1?.displayName?.charAt(0)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <Avatar className="h-10 w-10 border-2 border-gray-950 grayscale opacity-80">
                                                <AvatarImage src={team.player2?.photoURL} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400">
                                                    {team.player2?.displayName?.charAt(0)}
                                                </AvatarFallback>
                                            </Avatar>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-300">
                                                {team.player1?.displayName || "Unknown"} & {team.player2?.displayName || "Unknown"}
                                            </p>
                                            <Badge variant="outline" className="mt-1 bg-orange-500/10 text-orange-500 border-orange-500/20 text-[10px] h-5">
                                                Waitlist
                                            </Badge>
                                        </div>
                                    </div>

                                    {/* Leave Team Button (only for members) */}
                                    {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-red-400/10"
                                            onClick={() => handleLeaveTeam(team.teamId)}
                                            disabled={dissolveLoading}
                                            title="Leave Team"
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

            {/* Pending Teams Section */}
            {pendingTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-yellow-500/10 text-yellow-500 p-1 rounded">
                            <Clock className="w-4 h-4" />
                        </span>
                        Pending Confirmation ({pendingTeams.length})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingTeams.map((team) => {
                            const isInvitedUser = currentUser && team.player2Id === currentUser.uid;
                            const isCaptain = currentUser && team.player1Id === currentUser.uid;

                            return (
                                <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 border-dashed rounded-xl p-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center">
                                                <Avatar className="h-10 w-10 border-2 border-gray-800 z-10">
                                                    <AvatarImage src={team.player1?.photoURL} />
                                                    <AvatarFallback>{team.player1?.displayName?.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <Avatar className="h-10 w-10 border-2 border-gray-800 -ml-3 opacity-50 grayscale z-0">
                                                    <AvatarImage src={team.player2?.photoURL} />
                                                    <AvatarFallback>{team.player2?.displayName?.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">
                                                    {team.player1?.displayName}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {isInvitedUser
                                                        ? "Invited you to team up"
                                                        : `Invited ${team.player2?.displayName || "Unknown"} to team up`}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                                            Pending
                                        </Badge>
                                    </div>

                                    {isInvitedUser && !team.player2Confirmed && (
                                        <div className="flex gap-2 mt-2">
                                            <Button
                                                className="flex-1 bg-green-600 hover:bg-green-700 h-8 text-xs"
                                                onClick={() => onManageInvite && onManageInvite(team)}
                                            >
                                                <Check className="w-3 h-3 mr-1" />
                                                Respond
                                            </Button>
                                        </div>
                                    )}

                                    {isCaptain && !team.player2Confirmed && (
                                        <div className="mt-2">
                                            <p className="text-xs text-gray-500 text-center italic">
                                                Waiting for {team.player2?.displayName} to accept...
                                            </p>
                                            <Button
                                                variant="ghost"
                                                className="w-full mt-2 h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                                onClick={() => handleCancelInvite(team.teamId)}
                                                disabled={dissolveLoading}
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
        </div>
    );
}
