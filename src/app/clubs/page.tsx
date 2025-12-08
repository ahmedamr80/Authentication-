"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { ClubCard, ClubData } from "@/components/ClubCard";
import { Loader2, Building2, Bell, LogOut, Settings, User, Home, Calendar, Users } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

export default function ClubsPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [clubs, setClubs] = useState<ClubData[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    useEffect(() => {
        const fetchClubs = async () => {
            try {
                const clubsRef = collection(db, "clubs");
                // Order by name if possible, or createdAt. 
                // Since 'name' ordering might require an index if combined with other filters, 
                // we'll stick to a simple fetch or order by createdAt if available.
                // For now, let's try ordering by createdAt desc to show newest first.
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

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
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
            {/* Sticky Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push("/dashboard")}>
                        <Image src="/logo.svg" alt="EveryWherePadel Logo" width={32} height={32} className="w-8 h-8" />
                        <h1 className="text-xl font-bold bg-linear-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
                            EveryWherePadel
                        </h1>
                    </div>

                    {/* User Menu */}
                    <div className="relative">
                        {user ? (
                            <div className="flex items-center gap-4">
                                <button className="text-gray-400 hover:text-white transition-colors relative" onClick={() => router.push("/notifications")}>
                                    <Bell className="w-6 h-6" />
                                </button>
                                <div className="relative">
                                    <Avatar
                                        className="h-8 w-8 cursor-pointer border-2 border-transparent hover:border-orange-500 transition-all"
                                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                                    >
                                        <AvatarImage src={user.photoURL || undefined} />
                                        <AvatarFallback className="bg-orange-500 text-white">
                                            {user.displayName?.charAt(0) || "U"}
                                        </AvatarFallback>
                                    </Avatar>

                                    {/* Dropdown Menu */}
                                    {isUserMenuOpen && (
                                        <>
                                            <div
                                                className="fixed inset-0 z-40"
                                                onClick={() => setIsUserMenuOpen(false)}
                                            />
                                            <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                                <div className="p-4 border-b border-gray-800">
                                                    <p className="font-medium text-white truncate">{user.displayName}</p>
                                                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                                                </div>
                                                <div className="p-1">
                                                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
                                                        <User className="h-4 w-4" /> Profile
                                                    </button>
                                                    <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg transition-colors">
                                                        <Settings className="h-4 w-4" /> Settings
                                                    </button>
                                                </div>
                                                <div className="p-1 border-t border-gray-800">
                                                    <button
                                                        onClick={handleSignOut}
                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                                    >
                                                        <LogOut className="h-4 w-4" /> Sign Out
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <Button size="sm" onClick={() => router.push("/auth/signin")}>
                                Sign In
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-orange-500/10 rounded-full border border-orange-500/20">
                        <Building2 className="w-8 h-8 text-orange-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white">Clubs</h1>
                        <p className="text-gray-400 mt-1">Explore our partner clubs</p>
                    </div>
                </div>

                {clubs.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 text-lg">No clubs found.</p>
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
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-md border-t border-gray-800 px-6 py-3">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <Link href="/dashboard" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Home className="w-6 h-6" />
                        <span className="text-xs font-medium">Home</span>
                    </Link>
                    <Link href="/events" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Calendar className="w-6 h-6" />
                        <span className="text-xs font-medium">Events</span>
                    </Link>
                    <Link href="/community" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Users className="w-6 h-6" />
                        <span className="text-xs font-medium">Community</span>
                    </Link>
                </div>
            </nav>
        </div>
    );
}
