"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Bell, User as UserIcon, Settings, LogOut, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { auth } from "@/lib/firebase";
import { User } from "firebase/auth";

interface HeaderProps {
    user: User | null;
    showBack?: boolean;
    onBack?: () => void;
}

export function Header({ user, showBack = false, onBack }: HeaderProps) {
    const router = useRouter();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [profile, setProfile] = useState<{ displayName?: string, photoURL?: string } | null>(null);

    // Listen for unread notifications AND profile changes
    useEffect(() => {
        if (!user) return;

        // 1. Notifications Listener
        const notifQ = query(
            collection(db, "notifications"),
            where("userId", "==", user.uid),
            where("read", "==", false)
        );

        const unsubNotif = onSnapshot(notifQ, (snapshot) => {
            setUnreadCount(snapshot.size);
        });

        // 2. Profile Listener (to get latest photo/name)
        const userDocRef = doc(db, "users", user.uid);
        const unsubProfile = onSnapshot(userDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setProfile({
                    displayName: data.displayName || data.fullName,
                    photoURL: data.photoUrl || data.photoURL // Prioritize custom 'photoUrl' over 'photoURL'
                });
            }
        });

        return () => {
            unsubNotif();
            unsubProfile();
        };
    }, [user]);

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const handleBackClick = () => {
        if (onBack) {
            onBack();
        } else {
            router.back();
        }
    };

    // Derived display values
    const displayName = profile?.displayName || user?.displayName || "User";
    const photoURL = profile?.photoURL || user?.photoURL;

    return (
        <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {showBack && (
                        <button
                            onClick={handleBackClick}
                            className="mr-2 p-1 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft className="w-6 h-6" />
                        </button>
                    )}

                    <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => router.push("/dashboard")}
                    >
                        <Image
                            src="/logo.svg"
                            alt="EveryWherePadel Logo"
                            width={32}
                            height={32}
                            className="w-8 h-8"
                            style={{ width: 'auto' }}
                        />
                        <h1 className="text-xl font-bold bg-linear-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
                            EveryWherePadel
                        </h1>
                    </div>
                </div>

                {/* User Menu */}
                <div className="relative">
                    {user ? (
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.push("/notifications")}
                                className="relative text-gray-400 hover:text-white transition-colors"
                            >
                                <Bell className="w-6 h-6" />
                                {unreadCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center border-2 border-gray-950">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                            </button>
                            <div className="relative">
                                <Avatar
                                    className="h-8 w-8 cursor-pointer border-2 border-transparent hover:border-orange-500 transition-all"
                                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                                >
                                    <AvatarImage src={photoURL || undefined} />
                                    <AvatarFallback className="bg-orange-500 text-white">
                                        {displayName.charAt(0) || "U"}
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
                                                <p className="font-medium text-white truncate">{displayName}</p>
                                                <p className="text-xs text-gray-400 truncate">{user.email}</p>
                                            </div>
                                            <div className="p-1">
                                                <button
                                                    onClick={() => router.push("/player")}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
                                                >
                                                    <UserIcon className="h-4 w-4" /> Profile
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
    );
}
