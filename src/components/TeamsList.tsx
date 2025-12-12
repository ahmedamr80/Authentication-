"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Check, LogOut } from "lucide-react";
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
    status: "CONFIRMED" | "PENDING";
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
        if (!team) return;

        await dissolveTeam(
            currentUser,
            teamId,
            team.eventId,
            "LEAVE",
            undefined,
            () => showToast("Left team successfully", "success")
        );
    };

    const confirmedTeams = teams.filter(t => t.player1Confirmed && t.player2Confirmed);
    const pendingTeams = teams.filter(t => !t.player1Confirmed || !t.player2Confirmed);

    return (
        <div className="space-y-8">
            {/* Confirmed Teams Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span className="bg-green-500/10 text-green-500 p-1 rounded"><Check className="w-4 h-4" /></span>
                    Confirmed Teams ({confirmedTeams.length})
                </h3>
                {confirmedTeams.length === 0 && (
                    <div className="text-center py-8 bg-gray-900/50 rounded-xl border border-gray-800 border-dashed">
                        <p className="text-gray-500">No confirmed teams yet</p>
                    </div>
                )}
                <div className="space-y-3">
                    {confirmedTeams.map((team) => (
                        <div key={team.teamId} className="bg-gray-900/80 backdrop-blur-sm border border-green-500/30 rounded-xl p-4 relative group">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 flex-1">
                                    <div className="flex items-center -space-x-3">
                                        <Avatar className="h-12 w-12 border-2 border-gray-900 z-10"><AvatarImage src={team.player1?.photoURL} /><AvatarFallback>{team.player1?.displayName?.charAt(0)}</AvatarFallback></Avatar>
                                        <Avatar className="h-12 w-12 border-2 border-gray-900"><AvatarImage src={team.player2?.photoURL} /><AvatarFallback>{team.player2?.displayName?.charAt(0)}</AvatarFallback></Avatar>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-white truncate">{team.player1?.displayName} & {team.player2?.displayName}</p>
                                        <Badge className="bg-green-600 mt-1">Confirmed</Badge>
                                    </div>
                                </div>
                                {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                                    <Button variant="ghost" size="icon" className="text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleLeaveTeam(team.teamId)} disabled={dissolveLoading}>
                                        <LogOut className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Pending Teams Section */}
            {pendingTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-yellow-500/10 text-yellow-500 p-1 rounded"><Clock className="w-4 h-4" /></span>
                        Pending Confirmation ({pendingTeams.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingTeams.map((team) => {
                            // 1. Determine Roles Dynamically
                            const isP1 = currentUser && team.player1Id === currentUser.uid;
                            const isP2 = currentUser && team.player2Id === currentUser.uid;

                            // 2. Determine "Action State"
                            // Needs to Respond: I am a member AND my specific confirmation flag is false
                            const needsToRespond = (isP1 && !team.player1Confirmed) || (isP2 && !team.player2Confirmed);

                            // Is Waiting (Inviter): I am a member AND my specific confirmation flag is true
                            // (If the team is pending, and I AM confirmed, it means I'm waiting for the other person)
                            const isWaiting = (isP1 && team.player1Confirmed) || (isP2 && team.player2Confirmed);

                            // Name of the other person
                            const otherName = isP1 ? team.player2?.displayName : team.player1?.displayName;

                            return (
                                <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 border-dashed rounded-xl p-4">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center">
                                                <Avatar className="h-10 w-10 border-2 border-gray-800 z-10"><AvatarImage src={team.player1?.photoURL} /><AvatarFallback>{team.player1?.displayName?.charAt(0)}</AvatarFallback></Avatar>
                                                <Avatar className="h-10 w-10 border-2 border-gray-800 -ml-3 opacity-50 grayscale"><AvatarImage src={team.player2?.photoURL} /><AvatarFallback>{team.player2?.displayName?.charAt(0)}</AvatarFallback></Avatar>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-white">{team.player1?.displayName} & {team.player2?.displayName}</p>
                                                <p className="text-xs text-gray-500">
                                                    {needsToRespond
                                                        ? "Invited you to team up"
                                                        : `Waiting for ${otherName} to accept`}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="text-yellow-500 border-yellow-500/20">Pending</Badge>
                                    </div>

                                    {/* Show Respond Button ONLY if I need to respond */}
                                    {needsToRespond && (
                                        <Button className="w-full bg-green-600 hover:bg-green-700 h-8 text-xs" onClick={() => onManageInvite && onManageInvite(team)}>
                                            <Check className="w-3 h-3 mr-1" /> Respond
                                        </Button>
                                    )}

                                    {/* Show Cancel Button ONLY if I am waiting */}
                                    {isWaiting && (
                                        <Button variant="ghost" className="w-full h-8 text-xs text-red-400 hover:bg-red-400/10" onClick={() => handleLeaveTeam(team.teamId)} disabled={dissolveLoading}>
                                            Cancel Invitation
                                        </Button>
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