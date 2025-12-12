"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PlayerCard, PlayerData } from "@/components/PlayerCard";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Loader2, Users, ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { CommunityFilters, CommunityFiltersState } from "@/components/CommunityFilters";
import { SortControls, SortOption } from "@/components/SortControls";
import { useAuth } from "@/context/AuthContext";

export default function CommunityPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [members, setMembers] = useState<PlayerData[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    // Search and Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [filters, setFilters] = useState<CommunityFiltersState>({
        skillLevel: "",
        hand: "",
        position: "",
        gender: "",
        registrationMonth: "",
    });
    const [sortBy, setSortBy] = useState<SortOption>("newest");

    // 1. The "Resilient" Fetcher
    useEffect(() => {
        const fetchMembers = async () => {
            setLoading(true);
            try {
                const usersRef = collection(db, "users");
                let fetchedMembers: PlayerData[] = [];

                // Attempt 1: Try to find users marked specifically as "active players"
                try {
                    const activePlayersQuery = query(
                        usersRef,
                        where("isActive", "==", true),
                        where("role", "==", "player")
                    );
                    const snapshot = await getDocs(activePlayersQuery);
                    if (!snapshot.empty) {
                        fetchedMembers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as PlayerData));
                    }
                } catch (e) {
                    console.warn("Attempt 1 (Active Players) failed, trying fallback...", e);
                }

                // Attempt 2: If that fails, look for anyone with the role "player"
                if (fetchedMembers.length === 0) {
                    try {
                        const playersQuery = query(
                            usersRef,
                            where("role", "==", "player")
                        );
                        const snapshot = await getDocs(playersQuery);
                        if (!snapshot.empty) {
                            fetchedMembers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as PlayerData));
                        }
                    } catch (e) {
                        console.warn("Attempt 2 (Role Player) failed, trying fallback...", e);
                    }
                }

                // Attempt 3: The Safety Net - Grab everyone
                if (fetchedMembers.length === 0) {
                    const allUsersQuery = query(usersRef);
                    const snapshot = await getDocs(allUsersQuery);
                    fetchedMembers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as PlayerData));
                }

                setMembers(fetchedMembers);

            } catch (error) {
                console.error("Error fetching members:", error);
                showToast("Failed to load community members.", "error");
            } finally {
                setLoading(false);
            }
        };

        fetchMembers();
    }, [showToast]);

    // 2. The "Smart" Filter Engine & 3. The Sorting Hat
    const filteredAndSortedMembers = useMemo(() => {
        let result = [...members];

        // A. Filtering
        if (searchQuery) {
            const lowerQuery = searchQuery.toLowerCase();
            result = result.filter(member =>
                member.fullName?.toLowerCase().includes(lowerQuery) ||
                member.position?.toLowerCase().includes(lowerQuery) ||
                member.skillLevel?.toLowerCase().includes(lowerQuery)
            );
        }

        if (filters.skillLevel && filters.skillLevel !== "all") {
            result = result.filter(member => member.skillLevel?.toLowerCase() === filters.skillLevel);
        }

        if (filters.hand && filters.hand !== "all") {
            result = result.filter(member => member.hand?.toLowerCase() === filters.hand);
        }

        if (filters.position && filters.position !== "all") {
            result = result.filter(member => member.position?.toLowerCase().includes(filters.position));
        }

        if (filters.gender && filters.gender !== "all") {
            // @ts-expect-error: Filters might be undefined in the library type definition
            result = result.filter(member => member.gender?.toLowerCase() === filters.gender);
        }

        if (filters.registrationMonth && filters.registrationMonth !== "all") {
            const month = parseInt(filters.registrationMonth);
            result = result.filter(member => {
                if (!member.createdAt) return false;
                const date = member.createdAt.toDate();
                return date.getMonth() === month;
            });
        }

        // B. Sorting
        result.sort((a, b) => {
            switch (sortBy) {
                case "newest":
                    return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
                case "oldest":
                    return (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0);
                case "name":
                    return (a.fullName || "").localeCompare(b.fullName || "");
                case "skill":
                    const skillOrder: { [key: string]: number } = {
                        "beginner": 1,
                        "intermediate": 2,
                        "advanced": 3,
                        "expert": 4
                    };
                    const skillA = skillOrder[a.skillLevel?.toLowerCase() || ""] || 0;
                    const skillB = skillOrder[b.skillLevel?.toLowerCase() || ""] || 0;
                    return skillB - skillA; // High to Low
                default:
                    return 0;
            }
        });

        return result;
    }, [members, searchQuery, filters, sortBy]);

    const handleFilterChange = (key: keyof CommunityFiltersState, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilters = () => {
        setFilters({
            skillLevel: "",
            hand: "",
            position: "",
            gender: "",
            registrationMonth: "",
        });
        setSearchQuery("");
    };



    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            <Header user={user} />

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-6">
                {/* Header Section */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <Button
                            variant="ghost"
                            onClick={() => router.push("/dashboard")}
                            className="text-gray-400 hover:text-white mb-2 pl-0 hover:bg-transparent"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Dashboard
                        </Button>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg">
                                <Users className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white">Community</h1>
                                <p className="text-sm text-gray-400">
                                    {filteredAndSortedMembers.length} members found
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Controls Section */}
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <Input
                                placeholder="Search members..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-gray-900 border-gray-800 text-white placeholder:text-gray-500"
                            />
                        </div>
                        <SortControls sortBy={sortBy} onSortChange={setSortBy} />
                    </div>

                    <CommunityFilters
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        onClearFilters={clearFilters}
                    />
                </div>

                {/* Grid Section */}
                {filteredAndSortedMembers.length === 0 ? (
                    <div className="text-center py-12 bg-gray-900 rounded-xl border border-dashed border-gray-800">
                        <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-white">No members found</h3>
                        <p className="text-gray-400 mt-1 mb-4">
                            Try adjusting your filters or search query.
                        </p>
                        <Button onClick={clearFilters} variant="outline" className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white">
                            Clear all filters
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredAndSortedMembers.map((player) => (
                            <PlayerCard key={player.uid} player={player} />
                        ))}
                    </div>
                )}
            </main>

            <BottomNav />
        </div>
    );
}
