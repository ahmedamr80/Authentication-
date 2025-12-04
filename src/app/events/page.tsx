"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EventData } from "@/components/EventCard";
import { EventFilters, EventFilter } from "@/components/EventFilters";
import { EventSection } from "@/components/EventSection";
import { Loader2, Plus, Calendar, CalendarX, Home, Bell, User, Users, Settings, LogOut } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const EVENTS_PER_PAGE = 12;

const calculateStatus = (event: EventData): "Active" | "Upcoming" | "Past" | "Cancelled" => {
    if (event.cancellationMessage) return "Cancelled";

    const now = new Date();
    const eventDate = event.dateTime.toDate();
    const endDate = new Date(eventDate.getTime() + event.duration * 60000);

    if (now >= eventDate && now < endDate) return "Active";
    if (now < eventDate) return "Upcoming";
    return "Past";
};

export default function EventsPage() {
    const [events, setEvents] = useState<EventData[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeFilter, setActiveFilter] = useState<EventFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(EVENTS_PER_PAGE);
    const { showToast } = useToast();
    const router = useRouter();
    const { user } = useAuth();
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [userRegistrations, setUserRegistrations] = useState<Record<string, "CONFIRMED" | "WAITLIST">>({});

    const handleSignOut = async () => {
        try {
            await auth.signOut();
            router.push("/auth/signin");
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    // Real-time events listener
    useEffect(() => {
        // setLoading(true); // Removed redundant state update
        const eventsRef = collection(db, "events");
        const q = query(eventsRef, orderBy("dateTime", "asc"));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const eventsList: EventData[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                if (data.eventName && data.dateTime) {
                    const eventData: EventData = {
                        adminId: data.adminId,
                        cancellationMessage: data.cancellationMessage,
                        createdAt: data.createdAt,
                        dateTime: data.dateTime,
                        duration: data.duration || 60,
                        eventId: doc.id,
                        eventName: data.eventName,
                        isPublic: data.isPublic,
                        isTeamRegistration: data.isTeamRegistration,
                        locationName: data.locationName || "Unknown Location",
                        logoUrl: data.logoUrl,
                        pricePerPlayer: data.pricePerPlayer || 0,
                        slotsAvailable: data.slotsAvailable || 0,
                        status: "Upcoming",
                        termsAndConditions: data.termsAndConditions,
                        unitType: data.unitType || "Players",
                        clubId: data.clubId,
                        coordinates: data.coordinates,
                        registrationsCount: data.registrationsCount || 0,
                    };
                    eventData.status = calculateStatus(eventData);
                    eventsList.push(eventData);
                }
            });
            setEvents(eventsList);
            setLoading(false);
            setRefreshing(false);
        }, (error) => {
            console.error("Error fetching events:", error);
            showToast("Failed to load events. Please try again.", "error");
            setLoading(false);
            setRefreshing(false);
        });

        return () => unsubscribe();
    }, [showToast]);

    const handleRefresh = () => {
        setRefreshing(true);
        setTimeout(() => {
            setRefreshing(false);
            showToast("Events are up to date!", "success");
        }, 1000);
    };

    // Fetch user registrations
    useEffect(() => {
        if (!user) {
            // setUserRegistrations({}); // Removed to avoid set-state-in-effect
            return;
        }

        const registrationsRef = collection(db, "registrations");
        const q = query(registrationsRef, where("playerId", "==", user.uid));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const regs: Record<string, "CONFIRMED" | "WAITLIST"> = {};
            snapshot.forEach((doc) => {
                const data = doc.data();
                regs[data.eventId] = data.status;
            });
            setUserRegistrations(regs);
        });

        return () => unsubscribe();
    }, [user]);

    const { activeEvents, upcomingEvents, pastEvents } = useMemo(() => {
        let filtered = events;

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter((event) =>
                event.eventName.toLowerCase().includes(query) ||
                event.locationName.toLowerCase().includes(query)
            );
        }

        const active: EventData[] = [];
        const upcoming: EventData[] = [];
        const past: EventData[] = [];

        filtered.forEach((event) => {
            const status = calculateStatus(event);
            if (status === "Active") {
                active.push(event);
            } else if (status === "Upcoming") {
                upcoming.push(event);
            } else {
                past.push(event);
            }
        });

        upcoming.sort((a, b) => a.dateTime.toDate().getTime() - b.dateTime.toDate().getTime());
        past.sort((a, b) => b.dateTime.toDate().getTime() - a.dateTime.toDate().getTime());

        return { activeEvents: active, upcomingEvents: upcoming, pastEvents: past };
    }, [events, searchQuery]);

    const filteredEvents = useMemo(() => {
        switch (activeFilter) {
            case "active":
                return { active: activeEvents, upcoming: [], past: [] };
            case "upcoming":
                return { active: [], upcoming: upcomingEvents, past: [] };
            case "past":
                return { active: [], upcoming: [], past: pastEvents };
            default:
                return { active: activeEvents, upcoming: upcomingEvents, past: pastEvents };
        }
    }, [activeFilter, activeEvents, upcomingEvents, pastEvents]);

    const hasEventsToShow =
        filteredEvents.active.length > 0 ||
        filteredEvents.upcoming.length > 0 ||
        filteredEvents.past.length > 0;

    const totalFilteredEvents =
        filteredEvents.active.length +
        filteredEvents.upcoming.length +
        filteredEvents.past.length;

    const visibleEventsCount =
        Math.min(filteredEvents.active.length, visibleCount) +
        Math.min(filteredEvents.upcoming.length, visibleCount) +
        Math.min(filteredEvents.past.length, visibleCount);

    const hasMoreEvents = visibleEventsCount < totalFilteredEvents;
    const remainingEvents = totalFilteredEvents - visibleEventsCount;

    const handleClearFilters = () => {
        setActiveFilter("all");
        setSearchQuery("");
        setVisibleCount(EVENTS_PER_PAGE);
    };

    const handleLoadMore = () => {
        setVisibleCount((prev) => prev + EVENTS_PER_PAGE);
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
                        <Image src="/logo.svg" alt="EveryWherePadel Logo" width={32} height={32} className="w-8 h-8" style={{ width: 'auto' }} />
                        <h1 className="text-xl font-bold bg-linear-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
                            EveryWherePadel
                        </h1>
                    </div>

                    {/* User Menu */}
                    <div className="relative">
                        {user ? (
                            <div className="flex items-center gap-4">
                                <button className="text-gray-400 hover:text-white transition-colors">
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

            <main className="pt-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-8">
                {/* Header Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-white">Events</h1>
                            <p className="text-gray-400 mt-1">
                                Find and register for Padel events
                            </p>
                        </div>

                        <Link href="/events/create">
                            <Button className="bg-orange-500 hover:bg-orange-600 text-white border-none">
                                <Plus className="w-4 h-4 mr-2" />
                                Create Event
                            </Button>
                        </Link>
                    </div>
                </div>

                <EventFilters
                    activeFilter={activeFilter}
                    onFilterChange={setActiveFilter}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onClearFilters={handleClearFilters}
                    onRefresh={handleRefresh}
                    isRefreshing={refreshing}
                />

                {!hasEventsToShow ? (
                    <div className="text-center py-16 space-y-4">
                        <div className="flex justify-center">
                            <div className="p-6 bg-gray-900 rounded-full">
                                <CalendarX className="w-16 h-16 text-gray-600" />
                            </div>
                        </div>
                        <h3 className="text-xl font-semibold text-gray-300">No events found</h3>
                        <p className="text-gray-500 max-w-md mx-auto">
                            {searchQuery
                                ? `No events match "${searchQuery}". Try a different search term.`
                                : activeFilter !== "all"
                                    ? `No ${activeFilter} events at the moment.`
                                    : "There are no events available right now."}
                        </p>
                        <div className="flex justify-center gap-3 pt-4">
                            {(searchQuery || activeFilter !== "all") && (
                                <Button
                                    variant="outline"
                                    onClick={handleClearFilters}
                                    className="border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
                                >
                                    Clear Filters
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
                            >
                                {refreshing ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : null}
                                Refresh
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {filteredEvents.active.length > 0 && (
                            <EventSection
                                title="Happening Now"
                                events={filteredEvents.active.slice(0, visibleCount)}
                                variant="active"
                                userRegistrations={userRegistrations}
                            />
                        )}

                        {filteredEvents.upcoming.length > 0 && (
                            <EventSection
                                title="Upcoming Events"
                                events={filteredEvents.upcoming.slice(0, visibleCount)}
                                variant="upcoming"
                                userRegistrations={userRegistrations}
                            />
                        )}

                        {filteredEvents.past.length > 0 && (
                            <EventSection
                                title="Past Events"
                                events={filteredEvents.past.slice(0, visibleCount)}
                                variant="past"
                                userRegistrations={userRegistrations}
                            />
                        )}

                        {hasMoreEvents && (
                            <div className="flex justify-center pt-4">
                                <Button
                                    variant="outline"
                                    onClick={handleLoadMore}
                                    className="px-8 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
                                >
                                    Load More ({remainingEvents} remaining)
                                </Button>
                            </div>
                        )}
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
                    <Link href="/events" className="flex flex-col items-center gap-1 text-orange-500">
                        <Calendar className="w-6 h-6" />
                        <span className="text-xs font-medium">Events</span>
                    </Link>
                    <Link href="/community" className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 transition-colors">
                        <Users className="w-6 h-6" />
                        <span className="text-xs font-medium">Community</span>
                    </Link>
                </div>
            </nav>
        </div >
    );
}
