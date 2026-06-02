"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ClubCard, ClubData } from "@/components/ClubCard";
import { Building2, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const ClubCardSkeleton = () => (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden animate-pulse">
        <Skeleton className="h-48 w-full bg-gray-800" />
        <div className="p-5 space-y-4">
            <div className="space-y-2">
                <Skeleton className="h-6 w-2/3 bg-gray-800" />
                <Skeleton className="h-4 w-1/2 bg-gray-800" />
            </div>
            <div className="space-y-2 pt-2 border-t border-gray-800/60">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded bg-gray-800" />
                    <Skeleton className="h-4 w-3/4 bg-gray-800" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded bg-gray-800" />
                    <Skeleton className="h-4 w-1/2 bg-gray-800" />
                </div>
            </div>
        </div>
    </div>
);
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { Button } from "@/components/ui/button";

export default function ClubsPage() {
    const router = useRouter();
    // 1. Destructure isAdmin to secure the button
    const { user, isAdmin } = useAuth();
    const [clubs, setClubs] = useState<ClubData[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    useEffect(() => {
        const fetchClubs = async () => {
            try {
                const clubsRef = collection(db, "clubs");
                const q = query(clubsRef, orderBy("createdAt", "desc"));
                const querySnapshot = await getDocs(q);

                const clubsList: ClubData[] = [];
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    clubsList.push({
                        id: doc.id,
                        name: data.name || "Unknown Club",
                        location: data.location,
                        phone: data.phone,
                        pictureUrl: data.pictureUrl,
                        notes: data.notes,
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt,
                    } as ClubData);
                });

                setClubs(clubsList);
            } catch (error) {
                console.error("Error fetching clubs:", error);
                showToast("Failed to load clubs.", "error");
            } finally {
                setLoading(false);
            }
        };

        fetchClubs();
    }, [showToast]);



    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            {/* Sticky Header */}
            <Header user={user} showBack={true} onBack={() => router.push('/dashboard')} />

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
                {/* Header Section */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-orange-500/10 rounded-full border border-orange-500/20">
                            <Building2 className="w-8 h-8 text-orange-500" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-white">Clubs</h1>
                            <p className="text-gray-400 mt-1">Explore our partner clubs</p>
                        </div>
                    </div>

                    {/* 2. Admin Only Button */}
                    {isAdmin && (
                        <Button
                            onClick={() => router.push('/clubs/create')}
                            className="bg-orange-500 hover:bg-orange-600 text-white"
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            Add Club
                        </Button>
                    )}
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <ClubCardSkeleton key={i} />
                        ))}
                    </div>
                ) : clubs.length === 0 ? (
                    <div className="text-center py-12 bg-gray-900/50 rounded-xl border border-dashed border-gray-800">
                        <Building2 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">No clubs found.</p>
                        {isAdmin && (
                            <Button
                                variant="link"
                                className="text-orange-500 mt-2"
                                onClick={() => router.push('/clubs/create')}
                            >
                                Add the first one
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {clubs.map((club) => (
                            <ClubCard key={club.id} club={club} />
                        ))}
                    </div>
                )}
            </main>

            {/* Sticky Bottom Nav */}
            <BottomNav />
        </div>
    );
}