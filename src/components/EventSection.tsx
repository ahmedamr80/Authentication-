"use client";

import { EventCard, EventData } from "@/components/EventCard";

interface EventSectionProps {
    title: string;
    events: EventData[];
    emptyMessage?: string;
    variant?: "active" | "upcoming" | "past";
    userRegistrations?: Record<string, "CONFIRMED" | "WAITLIST">;
}

export function EventSection({ title, events, userRegistrations }: EventSectionProps) {
    if (events.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {events.map((event) => (
                    <EventCard
                        key={event.eventId}
                        event={event}
                        userRegistrationStatus={userRegistrations?.[event.eventId]}
                    />
                ))}
            </div>
        </div>
    );
}
