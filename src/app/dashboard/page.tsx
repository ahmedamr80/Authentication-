"use client";

import { useRouter } from "next/navigation";
import { Calendar, Users, Image as ImageIcon, User, Building2, Bell, LogOut, Settings, Home } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function DashboardPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    useEffect(() => {
        if (!user) return;

        const notifsRef = collection(db, "notifications");
        const q = query(
            notifsRef,
            where("userId", "==", user.uid),
            where("read", "==", false)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            setUnreadCount(snapshot.size);
        });

        return () => unsubscribe();
    }, [user]);

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const menuItems = [
        {
            title: "Events",
            icon: Calendar,
            path: "/events",
            color: "text-blue-400",
            bgColor: "bg-blue-500/10",
            description: "Browse and join padel events"
        },
        {
            title: "Notifications",
            icon: Bell,
            path: "/notifications",
            color: "text-yellow-400",
            bgColor: "bg-yellow-500/10",
            description: "View invites and updates",
            badge: unreadCount > 0 ? unreadCount : null
        },
        {
            title: "Media Library",
            icon: ImageIcon,
            path: "/media",
            color: "text-purple-400",
            bgColor: "bg-purple-500/10",
            description: "View your saved photos and videos"
        },
        {
            title: "Community",
            icon: Users,
            path: "/community",
            color: "text-green-400",
            bgColor: "bg-green-500/10",
            description: "Connect with other players"
        },
        {
            title: "Clubs",
            icon: Building2,
            path: "/clubs",
            color: "text-red-400",
            bgColor: "bg-red-500/10",
            description: "Find courts and clubs near you"
        },
        {
            title: "My Profile",
            icon: User,
            path: "/player",
            color: "text-orange-400",
            bgColor: "bg-orange-500/10",
            description: "Manage your profile and stats"
        }
    ];

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
                                    {unreadCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-950" />
                                    )}
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

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-2">
                        <h1 className="text-3xl font-bold text-white">Welcome Back</h1>
                        <p className="text-gray-400">What would you like to do today?</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {menuItems.map((item) => (
                        <Card
                            key={item.title}
                            className="cursor-pointer bg-gray-900 border-gray-800 hover:border-gray-700 hover:bg-gray-800/50 transition-all duration-300 group"
                            onClick={() => router.push(item.path)}
                        >
                            <CardContent className="p-6 flex items-center space-x-6">
                                <div className={`p-4 rounded-xl ${item.bgColor} group-hover:scale-110 transition-transform duration-300`}>
                                    <item.icon className={`w-8 h-8 ${item.color}`} />
                                </div>
                                <div className="space-y-1 flex-1">
                                    <h2 className="text-xl font-semibold text-white flex items-center justify-between">
                                        {item.title}
                                        {item.badge && (
                                            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                                                {item.badge}
                                            </span>
                                        )}
                                    </h2>
                                    <p className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">{item.description}</p>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </main>

            {/* Sticky Bottom Nav */}
            <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-950/90 backdrop-blur-md border-t border-gray-800 px-6 py-3">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    <Link href="/" className="flex flex-col items-center gap-1 text-orange-500">
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
