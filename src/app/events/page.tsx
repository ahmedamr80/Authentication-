"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, where, onSnapshot, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EventData } from "@/components/EventCard";
import { EventFilters, EventFilter } from "@/components/EventFilters";
import { EventSection } from "@/components/EventSection";
import { Loader2, Plus, CalendarX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const EventCardSkeleton = () => (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden space-y-4 p-5 animate-pulse">
        <div className="flex gap-4 items-center">
            <Skeleton className="w-14 h-14 rounded-xl shrink-0 bg-gray-800" />
            <div className="space-y-2 flex-1 min-w-0">
                <Skeleton className="h-5 w-3/4 bg-gray-800" />
                <Skeleton className="h-4 w-1/2 bg-gray-800" />
            </div>
        </div>
        <div className="space-y-2.5 pt-2">
            <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded bg-gray-800" />
                <Skeleton className="h-4 w-1/3 bg-gray-800" />
            </div>
            <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded bg-gray-800" />
                <Skeleton className="h-4 w-1/4 bg-gray-800" />
            </div>
        </div>
        <div className="flex justify-between items-center pt-4 border-t border-gray-800/60">
            <Skeleton className="h-8 w-20 rounded-lg bg-gray-800" />
            <Skeleton className="h-9 w-24 rounded-lg bg-gray-800" />
        </div>
    </div>
);
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";

const EVENTS_PER_PAGE = 12;

const calculateStatus = (event: EventData): "Active" | "Upcoming" | "Past" | "Cancelled" => {
    if (event.cancellationMessage || event.status === "Cancelled") return "Cancelled";

    const now = new Date();
    const eventDate = event.dateTime.toDate();
    const endDate = new Date(eventDate.getTime() + event.duration * 60000);

    if (now >= eventDate && now < endDate) return "Active";
    if (now < eventDate) return "Upcoming";
    return "Past";
};

export default function EventsPage() {
    const [events, setEvents] = useState<EventData[]>([]);
    const [isEventsLoading, setIsEventsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeFilter, setActiveFilter] = useState<EventFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(EVENTS_PER_PAGE);
    const { showToast } = useToast();
    const [userRegistrations, setUserRegistrations] = useState<Record<string, "CONFIRMED" | "WAITLIST" | "PENDING" | "CANCELLED">>({});
    const { user, isAdmin } = useAuth();

    // Live registration counts (single source of truth)
    const [liveRegistrationsCounts, setLiveRegistrationsCounts] = useState<Record<string, number>>({});

    // Real-time events listener
    useEffect(() => {
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
                        isPublic: data.isPublic, //i need to render only public events
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
            setIsEventsLoading(false);
            setRefreshing(false);
        }, (error) => {
            console.error("Error fetching events:", error);
            showToast("Failed to load events. Please try again.", "error");
            setIsEventsLoading(false);
            setRefreshing(false);
        });

        return () => unsubscribe();
    }, [showToast]);

    // Real-time registrations count listener (single source of truth)
    useEffect(() => {
        // Listen to ALL confirmed registrations for Players-type events
        const regsRef = collection(db, "registrations");
        const regsQuery = query(regsRef, where("status", "==", "CONFIRMED"));

        const unsubRegs = onSnapshot(regsQuery, (snapshot) => {
            const counts: Record<string, number> = {};
            snapshot.forEach((doc) => {
                const data = doc.data();
                const eid = data.eventId;
                if (eid) {
                    counts[eid] = (counts[eid] || 0) + 1;
                }
            });
            setLiveRegistrationsCounts(prev => ({ ...prev, ...counts }));
        });

        // Listen to ALL confirmed teams for Teams-type events
        const teamsRef = collection(db, "teams");
        const teamsQuery = query(teamsRef, where("status", "==", "CONFIRMED"));

        const unsubTeams = onSnapshot(teamsQuery, (snapshot) => {
            const teamCounts: Record<string, number> = {};
            snapshot.forEach((doc) => {
                const data = doc.data();
                const eid = data.eventId;
                if (eid) {
                    teamCounts[eid] = (teamCounts[eid] || 0) + 1;
                }
            });
            setLiveRegistrationsCounts(prev => ({ ...prev, ...teamCounts }));
        });

        return () => {
            unsubRegs();
            unsubTeams();
        };
    }, []);

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
            return;
        }

        const registrationsRef = collection(db, "registrations");
        // Update query to check BOTH slots
        // Query 1: Where I am the Primary Player
        const q1 = query(registrationsRef, where("playerId", "==", user.uid));

        // Query 2: Where I am the Partner
        const q2 = query(registrationsRef, where("player2Id", "==", user.uid));

        // We use a manual function to fetch and merge because 'onSnapshot'
        // doesn't easily support multiple queries without 'or()'
        // Note: For real-time updates without 'or', we attach two listeners.
        const regs: Record<string, "CONFIRMED" | "WAITLIST" | "PENDING"> = {};

        // Added strict type for the document snapshot
        const handleUpdate = (doc: QueryDocumentSnapshot<DocumentData>) => {
            const data = doc.data();
            let status = data.status;
            // Partner Logic: If I haven't accepted yet, show PENDING
            if (data.player2Id === user.uid && data.partnerStatus === "PENDING") {
                status = "PENDING";
            }

            regs[data.eventId] = status;
        };
        // Listener 1
        const unsubscribe1 = onSnapshot(q1, (snapshot) => {
            snapshot.forEach(handleUpdate);
            // We trigger state update after processing
            setUserRegistrations(prev => ({ ...prev, ...regs }));
        });

        // Listener 2
        const unsubscribe2 = onSnapshot(q2, (snapshot) => {
            snapshot.forEach(handleUpdate);
            setUserRegistrations(prev => ({ ...prev, ...regs }));
        });

        return () => {
            unsubscribe1();
            unsubscribe2();
        };
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
            } else if (status === "Cancelled") {
                const now = new Date();
                const eventDate = event.dateTime.toDate();
                const endDate = new Date(eventDate.getTime() + event.duration * 60000);
                if (now >= eventDate && now < endDate) {
                    active.push(event);
                } else if (now < eventDate) {
                    upcoming.push(event);
                } else {
                    past.push(event);
                }
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



    return (
        <div className="min-h-screen bg-gray-950 text-white pb-24">
            {/* Sticky Header */}
            <Header user={user} />

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

                        {/* 2. UPDATE: Only render this button if isAdmin is true */}
                        {isAdmin && (
                            <Link href="/events/create">
                                <Button className="bg-orange-500 hover:bg-orange-600 text-white border-none">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Create Event
                                </Button>
                            </Link>
                        )}
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

                {isEventsLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <EventCardSkeleton key={i} />
                        ))}
                    </div>
                ) : !hasEventsToShow ? (
                    <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-gray-900/40 rounded-2xl border border-gray-850 shadow-2xl relative overflow-hidden backdrop-blur-sm">
                        <div className="relative mb-6">
                            <div className="absolute inset-0 bg-orange-500/10 rounded-full blur-xl transform scale-150 animate-pulse"></div>
                            <div className="relative p-5 bg-gray-900 rounded-full border border-gray-800 shadow-xl">
                                <CalendarX className="w-10 h-10 text-orange-500/70" />
                            </div>
                        </div>
                        <h3 className="text-xl font-semibold text-white mb-2">No Events Found</h3>
                        <p className="text-gray-400 text-sm max-w-sm mb-8">
                            {searchQuery
                                ? `We couldn't find any events matching "${searchQuery}". Let's try adjusting the search query.`
                                : activeFilter !== "all"
                                    ? `There are no ${activeFilter} events right now. Check back soon!`
                                    : "There are no padel events available at the moment. Check back later or create a new one!"}
                        </p>
                        <div className="flex flex-wrap justify-center gap-3">
                            {(searchQuery || activeFilter !== "all") && (
                                <Button
                                    variant="outline"
                                    onClick={handleClearFilters}
                                    className="border-gray-800 text-gray-300 hover:text-white hover:bg-gray-800 rounded-xl px-5 py-2.5 transition-all duration-200"
                                >
                                    Clear Filters
                                </Button>
                            )}
                            <Button
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-medium px-6 py-2.5 rounded-xl shadow-lg shadow-orange-500/20 transition-all duration-200 hover:scale-[1.02]"
                            >
                                {refreshing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Refresh List
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-12">
                        {filteredEvents.active.length > 0 && (
                            <EventSection
                                title="Happening Now"
                                events={filteredEvents.active.slice(0, visibleCount)}
                                userRegistrations={userRegistrations}
                                liveRegistrationsCounts={liveRegistrationsCounts}
                            />
                        )}

                        {filteredEvents.upcoming.length > 0 && (
                            <EventSection
                                title="Upcoming Events"
                                events={filteredEvents.upcoming.slice(0, visibleCount)}
                                userRegistrations={userRegistrations}
                                liveRegistrationsCounts={liveRegistrationsCounts}
                            />
                        )}

                        {filteredEvents.past.length > 0 && (
                            <EventSection
                                title="Past Events"
                                events={filteredEvents.past.slice(0, visibleCount)}
                                userRegistrations={userRegistrations}
                                liveRegistrationsCounts={liveRegistrationsCounts}
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
            <BottomNav />
        </div >
    );
}