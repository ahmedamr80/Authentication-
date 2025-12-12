"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, where, onSnapshot, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EventData } from "@/components/EventCard";
import { EventFilters, EventFilter } from "@/components/EventFilters";
import { EventSection } from "@/components/EventSection";
import { Loader2, Plus, CalendarX } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";

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
    const [isEventsLoading, setIsEventsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeFilter, setActiveFilter] = useState<EventFilter>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [visibleCount, setVisibleCount] = useState(EVENTS_PER_PAGE);
    const { showToast } = useToast();
    const [userRegistrations, setUserRegistrations] = useState<Record<string, "CONFIRMED" | "WAITLIST" | "PENDING" | "CANCELLED">>({});
    const { user, isAdmin } = useAuth();

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

    if (isEventsLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            </div>
        );
    }

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
                                userRegistrations={userRegistrations}
                            />
                        )}

                        {filteredEvents.upcoming.length > 0 && (
                            <EventSection
                                title="Upcoming Events"
                                events={filteredEvents.upcoming.slice(0, visibleCount)}
                                userRegistrations={userRegistrations}
                            />
                        )}

                        {filteredEvents.past.length > 0 && (
                            <EventSection
                                title="Past Events"
                                events={filteredEvents.past.slice(0, visibleCount)}
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
            <BottomNav />
        </div >
    );
}