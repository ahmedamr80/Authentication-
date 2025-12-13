"use client";

import { useRouter } from "next/navigation";
import { Calendar, Users, Image as ImageIcon, User, Building2, Bell, CalendarClock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";

export default function DashboardPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);

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
