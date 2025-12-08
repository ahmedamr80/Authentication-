"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, UserPlus, UserCheck, AlertCircle, Check, ArrowLeft, Home, Calendar, Users, LogOut, Settings, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc, getDoc, getDocs, Timestamp } from "firebase/firestore";
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { PartnerResponseDialog } from "@/components/PartnerResponseDialog";
import { EventData } from "@/components/EventCard";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Notification {
    notificationId: string;
    type: "partner_invite" | "partner_accepted" | "partner_declined" | "welcome" | "system";
    title: string;
    message: string;
    read: boolean;
    createdAt: Timestamp;
    eventId?: string;
    fromUserId?: string;
    teamId?: string;
    action?: string;
    redirect?: string;
}

export default function NotificationsPage() {
    const { user } = useAuth();
    const router = useRouter();
    const { showToast } = useToast();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    // Dialog State
    const [showPartnerDialog, setShowPartnerDialog] = useState(false);
    const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
    const [partnerEvent, setPartnerEvent] = useState<EventData | null>(null);
    const [partnerUser, setPartnerUser] = useState<{ uid: string; displayName?: string } | null>(null);

    useEffect(() => {
        if (!user) return;

        const notifsRef = collection(db, "notifications");
        const q = query(
            notifsRef,
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const notifs = snapshot.docs.map(doc => ({
                notificationId: doc.id,
                ...doc.data()
            } as Notification));
            setNotifications(notifs);
        });

        return () => unsubscribe();
    }, [user]);

    const markAsRead = async (notificationId: string) => {
        try {
            const notifRef = doc(db, "notifications", notificationId);
            await updateDoc(notifRef, { read: true });
        } catch (error) {
            console.error("Error marking as read:", error);
        }
    };

    const markAllAsRead = async () => {
        // Batch update or loop (for simplicity loop here, batch better for many)
        const unread = notifications.filter(n => !n.read);
        unread.forEach(n => markAsRead(n.notificationId));
    };

    const handleNotificationClick = async (notification: Notification) => {
        // 1. Always mark as read immediately
        if (!notification.read) {
            markAsRead(notification.notificationId);
        }

        // 2. Logic for Partner Invites
        if (notification.type === "partner_invite" && notification.eventId && notification.fromUserId && notification.teamId) {
            try {
                // A. STALENESS CHECK: Does the team still exist?
                // (Our logic deletes the team if the initiator cancels/withdraws)
                const teamRef = doc(db, "teams", notification.teamId);
                const teamDoc = await getDoc(teamRef);

                if (!teamDoc.exists()) {
                    showToast("This invite is no longer valid (Team was cancelled).", "error");
                    return; // Stop here
                }

                // B. IDEMPOTENCY CHECK: Am I already registered?
                // (Prevent double-accepting)
                const regQuery = query(
                    collection(db, "registrations"),
                    where("eventId", "==", notification.eventId),
                    where("playerId", "==", user?.uid)
                );
                const regSnap = await getDocs(regQuery);

                if (!regSnap.empty) {
                    showToast("You have already responded to this invite.", "info");
                    router.push(`/events/${notification.eventId}`); // Just go to the page
                    return; // Stop here
                }

                // C. Fetch Data for Dialog (Only if checks pass)
                const eventDoc = await getDoc(doc(db, "events", notification.eventId));
                const userDoc = await getDoc(doc(db, "users", notification.fromUserId));

                if (eventDoc.exists() && userDoc.exists()) {
                    setPartnerEvent({ ...eventDoc.data(), eventId: eventDoc.id } as EventData);
                    setPartnerUser({ uid: userDoc.id, ...userDoc.data() });
                    setSelectedNotification(notification);
                    setShowPartnerDialog(true);
                } else {
                    showToast("Event or User details not found.", "error");
                }
            } catch (error) {
                console.error("Error handling invite click:", error);
                showToast("Failed to load invite details", "error");
            }
        }
        // 3. Logic for Redirects (System messages, etc.)
        else if (notification.redirect) {
            router.push(notification.redirect);
        } else if (notification.eventId) {
            router.push(`/events/${notification.eventId}`);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case "partner_invite": return <UserPlus className="h-5 w-5 text-blue-400" />;
            case "partner_accepted": return <UserCheck className="h-5 w-5 text-green-400" />;
            case "partner_declined": return <AlertCircle className="h-5 w-5 text-red-400" />;
            default: return <Bell className="h-5 w-5 text-gray-400" />;
        }
    };

    const formatTime = (timestamp: Timestamp) => {
        if (!timestamp) return "";
        const date = timestamp.toDate();
        const now = new Date();
        const diff = (now.getTime() - date.getTime()) / 1000; // seconds

        if (diff < 60) return "Just now";
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            {/* Sticky Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push("/dashboard")}>
                        <Image src="/logo.svg" alt="EveryWherePadel Logo" width={32} height={32} className="w-8 h-8" style={{ width: 'auto' }} />
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
                                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-950"></span>
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

            <main className="pt-24 px-4 sm:px-6 lg:px-8 max-w-2xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <Button
                            variant="ghost"
                            onClick={() => router.push("/dashboard")}
                            className="text-gray-400 hover:text-white mb-2 pl-0 hover:bg-transparent"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Dashboard
                        </Button>
                        <h1 className="text-3xl font-bold text-white">Notifications</h1>
                        <p className="text-gray-400">
                            {unreadCount > 0 ? `You have ${unreadCount} unread notifications` : "You're all caught up!"}
                        </p>
                    </div>
                    {unreadCount > 0 && (
                        <Button variant="ghost" onClick={markAllAsRead} className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10">
                            <Check className="w-4 h-4 mr-2" />
                            Mark all read
                        </Button>
                    )}
                </div>

                <div className="space-y-3">
                    {notifications.length === 0 ? (
                        <Card className="bg-gray-900 border-gray-800">
                            <CardContent className="flex flex-col items-center justify-center py-12 text-gray-500">
                                <Bell className="w-12 h-12 mb-4 opacity-20" />
                                <p>No notifications yet</p>
                            </CardContent>
                        </Card>
                    ) : (
                        notifications.map((notification) => (
                            <Card
                                key={notification.notificationId}
                                className={`cursor-pointer transition-colors border-gray-800 hover:bg-gray-800/50 ${!notification.read ? "bg-gray-900/80 border-l-4 border-l-blue-500" : "bg-gray-900"}`}
                                onClick={() => handleNotificationClick(notification)}
                            >
                                <CardContent className="p-4 flex items-start gap-4">
                                    <div className={`p-2 rounded-full ${!notification.read ? "bg-gray-800 shadow-sm" : "bg-gray-800/50"}`}>
                                        {getIcon(notification.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h3 className={`text-sm font-medium ${!notification.read ? "text-white" : "text-gray-400"}`}>
                                                {notification.title}
                                            </h3>
                                            <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
                                                {formatTime(notification.createdAt)}
                                            </span>
                                        </div>
                                        <p className={`text-sm mt-1 ${!notification.read ? "text-gray-300" : "text-gray-500"}`}>
                                            {notification.message}
                                        </p>
                                    </div>
                                    {!notification.read && (
                                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 shrink-0" />
                                    )}
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
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

            {/* Partner Response Dialog */}
            {showPartnerDialog && partnerEvent && partnerUser && selectedNotification && (
                <PartnerResponseDialog
                    open={showPartnerDialog}
                    onOpenChange={setShowPartnerDialog}
                    notification={selectedNotification as { teamId: string; notificationId: string }}
                    event={partnerEvent}
                    requester={partnerUser}
                    currentUser={user}
                    onSuccess={() => {
                        // Refresh or handle post-success if needed (snapshot handles list update)
                    }}
                />
            )}
        </div>
    );
}
