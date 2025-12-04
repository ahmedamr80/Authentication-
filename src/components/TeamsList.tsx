"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Check, X, LogOut } from "lucide-react";
import { db } from "@/lib/firebase";
import { doc, runTransaction, Timestamp, collection, query, where, getDocs } from "firebase/firestore";

import { User } from "firebase/auth";
import { useToast } from "@/context/ToastContext";

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

export function TeamsList({ currentUser, teams, loading, onManageInvite }: TeamsListProps) {
    const { showToast } = useToast();


    const handleLeaveTeam = async (teamId: string) => {
        if (!currentUser) return;
        if (!confirm("Are you sure you want to leave this team?")) return;

        try {
            // 1. Get Team Data
            const teamRef = doc(db, "teams", teamId);
            const teamSnap = await import("firebase/firestore").then(m => m.getDoc(teamRef));
            if (!teamSnap.exists()) throw new Error("Team not found");
            const teamData = teamSnap.data();

            // 2. Find Registrations for both players
            const regsRef = collection(db, "registrations");
            const q1 = query(regsRef, where("eventId", "==", teamData.eventId), where("playerId", "==", teamData.player1Id));
            const q2 = teamData.player2Id ? query(regsRef, where("eventId", "==", teamData.eventId), where("playerId", "==", teamData.player2Id)) : null;

            const [snap1, snap2] = await Promise.all([
                getDocs(q1),
                q2 ? getDocs(q2) : Promise.resolve(null)
            ]);

            await runTransaction(db, async (transaction) => {
                // Verify team exists
                const tDoc = await transaction.get(teamRef);
                if (!tDoc.exists()) throw new Error("Team no longer exists");

                // Delete Team
                transaction.delete(teamRef);

                // Update Player 1 Registration
                if (!snap1.empty) {
                    const reg1Ref = doc(db, "registrations", snap1.docs[0].id);
                    transaction.update(reg1Ref, {
                        teamId: null,
                        partnerStatus: "NONE",
                        lookingForPartner: true,
                        status: "CONFIRMED",
                        _debugSource: "TeamsList.tsx - handleLeaveTeam - Update Player 1 Registration"
                    });
                }

                // Update Player 2 Registration
                if (snap2 && !snap2.empty) {
                    const reg2Ref = doc(db, "registrations", snap2.docs[0].id);
                    transaction.update(reg2Ref, {
                        teamId: null,
                        partnerStatus: "NONE",
                        lookingForPartner: true,
                        status: "CONFIRMED",
                        _debugSource: "TeamsList.tsx - handleLeaveTeam - Update Player 2 Registration"
                    });
                }
            });

            showToast("Left team successfully", "success");
        } catch (error) {
            console.error("Error leaving team:", error);
            showToast("Failed to leave team", "error");
        }
    };

    const confirmedTeams = teams.filter(t => t.player1Confirmed && t.player2Confirmed);
    const pendingTeams = teams.filter(t => !t.player1Confirmed || !t.player2Confirmed);

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
                            <div key={team.teamId} className="bg-gray-900/80 backdrop-blur-sm border border-green-500/30 rounded-xl p-4 hover:border-green-500/50 transition-colors relative group">
                                <div className="flex items-center justify-between">
                                    {/* Left: Overlapping Avatars + Names */}
                                    <div className="flex items-center gap-3 flex-1">
                                        {/* Overlapping Avatars */}
                                        <div className="flex items-center -space-x-3">
                                            <Avatar className="h-12 w-12 border-2 border-gray-900 z-10">
                                                <AvatarImage src={team.player1?.photoURL} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400">
                                                    {team.player1?.displayName?.charAt(0) || "?"}
                                                </AvatarFallback>
                                            </Avatar>
                                            <Avatar className="h-12 w-12 border-2 border-gray-900">
                                                <AvatarImage src={team.player2?.photoURL} />
                                                <AvatarFallback className="bg-gray-800 text-gray-400">
                                                    {team.player2?.displayName?.charAt(0) || "?"}
                                                </AvatarFallback>
                                            </Avatar>
                                        </div>

                                        {/* Names and Skill Levels */}
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-white truncate">
                                                {team.player1?.displayName || "Unknown"} & {team.player2?.displayName || "Unknown"}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
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

                                    {/* Right: Confirmed Badge */}
                                    <Badge className="bg-green-600 hover:bg-green-600 text-white border-0 flex items-center gap-1.5">
                                        <Check className="w-3 h-3" />
                                        Confirmed
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
                                                onClick={() => handleLeaveTeam(team.teamId)}
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
