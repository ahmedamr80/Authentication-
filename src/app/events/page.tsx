"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EventCard, EventData } from "@/components/EventCard";
import { EventFilters, EventFilter } from "@/components/EventFilters";
import { EventSection } from "@/components/EventSection";
import { Loader2, ArrowLeft, Plus, Calendar, CalendarX } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";

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

    const fetchEvents = useCallback(async (showRefreshToast = false) => {
        try {
            if (showRefreshToast) setRefreshing(true);

            const eventsRef = collection(db, "events");
            const q = query(eventsRef, orderBy("dateTime", "asc"));
            const querySnapshot = await getDocs(q);

            const eventsList: EventData[] = [];
            querySnapshot.forEach((doc) => {
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
                    };
                    eventData.status = calculateStatus(eventData);
                    eventsList.push(eventData);
                }
            });

            setEvents(eventsList);
            if (showRefreshToast) {
                showToast("Events refreshed successfully!", "success");
            }
        } catch (error) {
            console.error("Error fetching events:", error);
            showToast("Failed to load events. Please try again.", "error");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [showToast]);

    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);

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
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <Button
                        variant="ghost"
                        onClick={() => router.push("/dashboard")}
                        className="text-gray-600 hover:text-gray-900"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Dashboard
                    </Button>

                    <Link href="/" className="flex items-center">
                        <Image
                            src="/logo.svg"
                            alt="Logo"
                            width={48}
                            height={48}
                            className="h-12 w-auto"
                        />
                    </Link>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 rounded-full">
                            <Calendar className="w-8 h-8 text-blue-600" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">Events</h1>
                            <p className="text-gray-600 mt-1">
                                Discover and join padel events
                                {events.length > 0 && (
                                    <span className="text-gray-400 ml-2">
                                        ({events.length} total)
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    <Link href="/events/create">
                        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                            <Plus className="w-4 h-4 mr-2" />
                            Create Event
                        </Button>
                    </Link>
                </div>

                <EventFilters
                    activeFilter={activeFilter}
                    onFilterChange={setActiveFilter}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onClearFilters={handleClearFilters}
                    onRefresh={() => fetchEvents(true)}
                    isRefreshing={refreshing}
                />

                {!hasEventsToShow ? (
                    <div className="text-center py-16 space-y-4">
                        <div className="flex justify-center">
                            <div className="p-6 bg-gray-100 rounded-full">
                                <CalendarX className="w-16 h-16 text-gray-400" />
                            </div>
                        </div>
                        <h3 className="text-xl font-semibold text-gray-700">No events found</h3>
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
                                >
                                    Clear Filters
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={() => fetchEvents(true)}
                                disabled={refreshing}
                            >
                                {refreshing ? (
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : null}
                                Refresh
                            </Button>
                            <Link href="/events/create">
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Create Event
                                </Button>
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {filteredEvents.active.length > 0 && (
                            <EventSection
                                title="Happening Now"
                                events={filteredEvents.active.slice(0, visibleCount)}
                                variant="active"
                            />
                        )}

                        {filteredEvents.upcoming.length > 0 && (
                            <EventSection
                                title="Upcoming Events"
                                events={filteredEvents.upcoming.slice(0, visibleCount)}
                                variant="upcoming"
                            />
                        )}

                        {filteredEvents.past.length > 0 && (
                            <EventSection
                                title="Past Events"
                                events={filteredEvents.past.slice(0, visibleCount)}
                                variant="past"
                            />
                        )}

                        {hasMoreEvents && (
                            <div className="flex justify-center pt-4">
                                <Button
                                    variant="outline"
                                    onClick={handleLoadMore}
                                    className="px-8"
                                >
                                    Load More ({remainingEvents} remaining)
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
