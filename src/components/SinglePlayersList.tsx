import { EventData, Registration } from "@/lib/types";
import { User } from "firebase/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, Hand, MapPin } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { addDoc, collection, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface SinglePlayer {
    registrationId: string;
    playerId: string;
    displayName: string;
    photoURL?: string;
    lookingForPartner: boolean;
    playerHand?: string;
    playerPosition?: string;
    playerSkillLevel?: string;
    partnerStatus?: string;
}

export interface SinglePlayersListProps {
    event: EventData | null;
    currentUser: User | null;
    userRegistration?: Registration | null;
    players: SinglePlayer[];
    loading: boolean;
}

export function SinglePlayersList({ event, currentUser, userRegistration, players, loading }: SinglePlayersListProps) {
    const { showToast } = useToast();

    const handleInvite = async (player: SinglePlayer) => {
        if (!currentUser || !event) return;

        try {
            // Check if invite already exists
            const invitesRef = collection(db, "teams");
            const q = query(
                invitesRef,
                where("eventId", "==", event.eventId),
                where("player1Id", "==", currentUser.uid),
                where("player2Id", "==", player.playerId)
            );
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                showToast("Invitation already sent", "info");
                return;
            }

            // Create pending team
            const teamRef = await addDoc(collection(db, "teams"), {
                eventId: event.eventId,
                player1Id: currentUser.uid,
                player2Id: player.playerId,
                status: "PENDING",
                createdAt: serverTimestamp(),
                fullNameP1: currentUser.displayName || "Unknown Player",
                fullNameP2: player.displayName || "Unknown Player",
                player1Confirmed: true,
                player2Confirmed: false
            });

            // Create notification for the invited player
            await addDoc(collection(db, "notifications"), {
                userId: player.playerId,
                type: "TEAM_INVITE",
                message: `${currentUser.displayName || "Someone"} invited you to join their team for ${event.eventName}`,
                eventId: event.eventId,
                eventName: event.eventName,
                teamId: teamRef.id,
                read: false,
                createdAt: serverTimestamp()
            });

            showToast(`Invitation sent to ${player.displayName}`, "success");
        } catch (error) {
            console.error("Error sending invite:", error);
            showToast("Failed to send invitation", "error");
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
            {players.map((player) => (
                <div key={player.registrationId} className="bg-gray-900/80 backdrop-blur-sm border border-green-500/30 rounded-xl p-4 hover:border-green-500/50 transition-all group relative overflow-hidden">
                    <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12 border-2 border-gray-800">
                            <AvatarImage src={player.photoURL} />
                            <AvatarFallback className="bg-gray-800 text-gray-400">
                                {player.displayName.charAt(0)}
                            </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <h4 className="text-base font-semibold text-white truncate pr-2">
                                    {player.displayName}
                                </h4>
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

                    {currentUser && currentUser.uid !== player.playerId && event?.unitType === "Teams" && (
                        (!userRegistration || userRegistration.lookingForPartner) &&
                        (player.lookingForPartner || player.partnerStatus === "DENIED") && (
                            <div className="mt-4 pt-4 border-t border-gray-800 flex justify-end">
                                <Button
                                    size="sm"
                                    className="bg-orange-500 hover:bg-orange-600 text-white text-xs h-8"
                                    onClick={() => handleInvite(player)}
                                >
                                    <UserPlus className="h-3 w-3 mr-1.5" />
                                    Invite to Team
                                </Button>
                            </div>
                        )
                    )}
                </div>
            ))}
        </div>
    );
}
