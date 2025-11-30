"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { EventCard, EventData } from "@/components/EventCard";
import { Loader2 } from "lucide-react";
import { useToast } from "@/context/ToastContext";

export default function EventsPage() {
    const [events, setEvents] = useState<EventData[]>([]);
    const [loading, setLoading] = useState(true);
    const { showToast } = useToast();

    useEffect(() => {
        const fetchEvents = async () => {
            try {
                const eventsRef = collection(db, "events");
                // Ordering by dateTime to show upcoming events first (or past events last)
                const q = query(eventsRef, orderBy("dateTime", "asc"));
                const querySnapshot = await getDocs(q);

                const eventsList: EventData[] = [];
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    // Basic validation to ensure required fields exist
                    if (data.eventName && data.dateTime) {
                        eventsList.push({
                            adminId: data.adminId,
                            cancellationMessage: data.cancellationMessage,
                            createdAt: data.createdAt,
                            dateTime: data.dateTime,
                            duration: data.duration || 60,
                            eventId: doc.id, // Use doc.id as eventId
                            eventName: data.eventName,
                            isPublic: data.isPublic,
                            isTeamRegistration: data.isTeamRegistration,
                            locationName: data.locationName || "Unknown Location",
                            logoUrl: data.logoUrl,
                            pricePerPlayer: data.pricePerPlayer || 0,
                            slotsAvailable: data.slotsAvailable || 0,
                            status: data.status || "Upcoming",
                            termsAndConditions: data.termsAndConditions,
                            unitType: data.unitType || "Players",
                            clubId: data.clubId,
                            coordinates: data.coordinates,
                        } as EventData);
                    }
                });

                setEvents(eventsList);
            } catch (error) {
                console.error("Error fetching events:", error);
                showToast("Failed to load events. Please try again.", "error");
            } finally {
                setLoading(false);
            }
        };

        fetchEvents();
    }, [showToast]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Events</h1>
                        <p className="text-gray-600 mt-1">Discover and join upcoming padel events</p>
                    </div>
                </div>

                {events.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 text-lg">No events found.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {events.map((event) => (
                            <EventCard key={event.eventId} event={event} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
