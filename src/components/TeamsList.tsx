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
        if (!team) return;
        await dissolveTeam(currentUser, teamId, team.eventId, "LEAVE", undefined, () => showToast("Left team successfully", "success"));
    };

    const handleCancelInvite = async (teamId: string) => {
        if (!currentUser) return;
        if (!confirm("Cancel this invitation?")) return;
        const team = teams.find(t => t.teamId === teamId);
        if (!team) return;
        await dissolveTeam(currentUser, teamId, team.eventId, "CANCEL", undefined, () => showToast("Invitation canceled", "success"));
    };

    const confirmedTeams = teams.filter(t => t.status === "CONFIRMED" || (t.player1Confirmed && t.player2Confirmed && t.status !== "WAITLIST"));
    const pendingTeams = teams.filter(t => t.status === "PENDING" || ((!t.player1Confirmed || !t.player2Confirmed) && t.status !== "WAITLIST"));
    const waitlistTeams = teams.filter(t => t.status === "WAITLIST");

    return (
        <div className="space-y-8">
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <span className="bg-green-500/10 text-green-500 p-1 rounded"><Check className="w-4 h-4" /></span>
                    Confirmed Teams ({confirmedTeams.length})
                </h3>

                {confirmedTeams.map((team) => (
                    <div key={team.teamId} className="bg-gray-900/80 border border-green-500/30 rounded-xl p-3 sm:p-4 relative group">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                <div className="flex items-center -space-x-2 sm:-space-x-3 shrink-0">
                                    <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border-2 border-gray-900 z-10">
                                        <AvatarImage src={team.player1?.photoURL} />
                                        <AvatarFallback>{team.player1?.displayName?.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border-2 border-gray-900">
                                        <AvatarImage src={team.player2?.photoURL} />
                                        <AvatarFallback>{team.player2?.displayName?.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                </div>
                                <div className="min-w-0 flex-1 text-sm sm:text-base">
                                    <p className="truncate text-white font-medium block sm:hidden">{team.player1?.displayName}</p>
                                    <p className="truncate text-gray-400 text-xs block sm:hidden">& {team.player2?.displayName}</p>
                                    <p className="truncate text-white font-medium hidden sm:block">{team.player1?.displayName} & {team.player2?.displayName}</p>
                                </div>
                            </div>
                            <Badge className="bg-green-600 text-white shrink-0"><Check className="w-3 h-3 h-3 mr-1" /><span className="hidden sm:inline">Confirmed</span></Badge>
                        </div>
                        {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                            <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => handleLeaveTeam(team.teamId)}><LogOut className="h-3 w-3" /></Button>
                        )}
                    </div>
                ))}
            </div>

            {waitlistTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-orange-500/10 text-orange-500 p-1 rounded"><Hourglass className="w-4 h-4" /></span>
                        Waitlist ({waitlistTeams.length})
                    </h3>
                    {waitlistTeams.map(team => (
                        <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 rounded-xl p-4 flex justify-between items-center">
                            <p className="text-sm text-gray-300">{team.player1?.displayName} & {team.player2?.displayName}</p>
                            {currentUser && (team.player1Id === currentUser.uid || team.player2Id === currentUser.uid) && (
                                <Button variant="ghost" size="icon" onClick={() => handleLeaveTeam(team.teamId)}><LogOut className="h-4 h-4" /></Button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {pendingTeams.length > 0 && (
                <div className="space-y-4 pt-4 border-t border-gray-800">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <span className="bg-yellow-500/10 text-yellow-500 p-1 rounded"><Clock className="w-4 h-4" /></span>
                        Pending ({pendingTeams.length})
                    </h3>
                    {pendingTeams.map(team => (
                        <div key={team.teamId} className="bg-gray-950 border border-orange-500/30 rounded-xl p-4">
                            <div className="flex justify-between items-center mb-2">
                                <p className="text-sm text-white">{team.player1?.displayName} invited {team.player2?.displayName}</p>
                                <Badge variant="outline" className="text-yellow-500">Pending</Badge>
                            </div>
                            {currentUser?.uid === team.player2Id && !team.player2Confirmed && (
                                <Button className="w-full bg-green-600 h-8 text-xs" onClick={() => onManageInvite?.(team)}>Respond</Button>
                            )}
                            {currentUser?.uid === team.player1Id && !team.player2Confirmed && (
                                <Button variant="ghost" className="w-full mt-2 h-8 text-xs text-red-400" onClick={() => handleCancelInvite(team.teamId)}>Cancel</Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
