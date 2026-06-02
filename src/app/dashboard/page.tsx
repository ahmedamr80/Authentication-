"use client";

import { useRouter } from "next/navigation";
import { Calendar, Users, Image as ImageIcon, User, Building2, Bell, CalendarClock, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const PUSH_PROMPT_DISMISSED_KEY = "ewp_push_prompt_dismissed";

export default function DashboardPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);
    const { notificationPermissionStatus, requestPermission } = usePushNotifications();
    const [pushPromptDismissed, setPushPromptDismissed] = useState(true); // default true to avoid flash

    // Check localStorage for dismissed state on mount
    useEffect(() => {
        if (typeof window !== "undefined") {
            const dismissed = localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY) === "true";
            setTimeout(() => {
                setPushPromptDismissed(dismissed);
            }, 0);
        }
    }, []);

    const dismissPushPrompt = () => {
        setPushPromptDismissed(true);
        localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY, "true");
    };

    const handleEnableNotifications = async () => {
        await requestPermission();
        dismissPushPrompt();
    };

    const showPushPrompt =
        notificationPermissionStatus === "default" && !pushPromptDismissed;

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
        }, (error) => {
            if (error.code !== "permission-denied") console.error("Dashboard notification listener error:", error);
        });

        return () => unsubscribe();
    }, [user]);

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
            title: "My Schedule",
            icon: CalendarClock,
            path: "/player/my-schedule",
            color: "text-teal-400",
            bgColor: "bg-teal-500/10",
            description: "View your upcoming games and history"
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

    if (!user) return null;

    return (
        <div className="min-h-screen bg-black text-white pb-24 relative">
            {/* Background Gradient */}
            <div className="fixed inset-0 z-0 bg-linear-to-b from-gray-900 via-black to-black" />

            <Header user={user} />

            {/* Main Content */}
            <main className="relative z-10 pt-24 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                    <div className="space-y-2">
                        <h1 className="text-3xl font-bold text-white">Welcome Back</h1>
                        <p className="text-gray-400">What would you like to do today?</p>
                    </div>
                </div>

                {/* Push Notification Opt-in Prompt */}
                {showPushPrompt && (
                    <div className="relative overflow-hidden rounded-xl border border-blue-500/30 bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20 p-4">
                        <button
                            onClick={dismissPushPrompt}
                            className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
                            aria-label="Dismiss notification prompt"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-full bg-blue-500/20 shrink-0">
                                <Bell className="w-6 h-6 text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-semibold text-white">Stay in the loop</h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Get notified about event invites, team updates, and more.
                                </p>
                            </div>
                            <button
                                onClick={handleEnableNotifications}
                                className="shrink-0 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
                            >
                                Enable
                            </button>
                        </div>
                    </div>
                )}

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

            <BottomNav />
        </div>
    );
}
