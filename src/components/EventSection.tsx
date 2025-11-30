"use client";

import { EventCard, EventData } from "@/components/EventCard";

interface EventSectionProps {
    title: string;
    events: EventData[];
    emptyMessage?: string;
    variant?: "active" | "upcoming" | "past";
}

export function EventSection({ title, events, emptyMessage, variant = "upcoming" }: EventSectionProps) {
    if (events.length === 0) {
        return null;
    }

    const sectionStyles = {
        active: "border-l-4 border-green-500 pl-4",
        upcoming: "border-l-4 border-blue-500 pl-4",
        past: "border-l-4 border-gray-400 pl-4 opacity-75",
    };

    return (
        <div className={`space-y-4 ${sectionStyles[variant]}`}>
            <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {events.map((event) => (
                    <EventCard key={event.eventId} event={event} />
                ))}
            </div>
        </div>
    );
}
