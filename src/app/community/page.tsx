"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PlayerCard, PlayerData } from "@/components/PlayerCard";
import { Loader2, Users } from "lucide-react";
import { useToast } from "@/context/ToastContext";

export default function CommunityPage() {
    const [players, setPlayers] = useState<PlayerData[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    useEffect(() => {
        const fetchPlayers = async () => {
            try {
                const usersRef = collection(db, "users");
                const q = query(usersRef, orderBy("createdAt", "desc"));
                const querySnapshot = await getDocs(q);

                const playersList: PlayerData[] = [];
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    playersList.push({
                        uid: doc.id,
                        photoUrl: data.photoUrl,
                        fullName: data.fullName || "Unknown Player",
                        position: data.position,
                        hand: data.hand,
                        createdAt: data.createdAt,
                        skillLevel: data.skillLevel,
                        createdBy: data.createdBy,
                    } as PlayerData);
                });

                setPlayers(playersList);
            } catch (error) {
                console.error("Error fetching players:", error);
                showToast("Failed to load community members.", "error");
            } finally {
                setLoading(false);
            }
        };

        fetchPlayers();
    }, [showToast]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-green-100 rounded-full">
                        <Users className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Community</h1>
                        <p className="text-gray-600 mt-1">Meet our {players.length} players</p>
                    </div>
                </div>

                {players.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 text-lg">No players found.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {players.map((player) => (
                            <PlayerCard key={player.uid} player={player} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
