import { Calendar, Clock, MapPin, Users } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Timestamp } from "firebase/firestore";
import Link from "next/link";

export interface EventData {
    adminId: string;
    cancellationMessage?: string;
    createdAt: Timestamp;
    dateTime: Timestamp;
    duration: number;
    eventId: string;
    eventName: string;
    isPublic: boolean;
    isTeamRegistration: boolean;
    locationName: string;
    logoUrl?: string;
    pricePerPlayer: number;
    slotsAvailable: number;
    status: string;
    termsAndConditions?: string;
    unitType: "Players" | "Teams";
    clubId?: string;
    coordinates?: {
        lat: number;
        lng: number;
    };
    registrationsCount?: number;
}

export const calculateEventStatus = (event: EventData): "Active" | "Upcoming" | "Past" | "Cancelled" => {
    if (event.cancellationMessage) return "Cancelled";

    const now = new Date();
    const eventDate = event.dateTime.toDate();
    const endDate = new Date(eventDate.getTime() + event.duration * 60000);

    if (now >= eventDate && now < endDate) return "Active";
    if (now < eventDate) return "Upcoming";
    return "Past";
};

interface EventCardProps {
    event: EventData;
    userRegistrationStatus?: "CONFIRMED" | "WAITLIST" | "PENDING" | "CANCELLED" | null;
}

export function EventCard({ event, userRegistrationStatus }: EventCardProps) {
    const eventDate = event.dateTime.toDate();
    const dynamicStatus = calculateEventStatus(event);
    const formattedDate = eventDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
    const formattedTime = eventDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    const filledSlots = event.registrationsCount || 0;
    const totalSlots = event.slotsAvailable;
    const progressPercentage = Math.min(100, (filledSlots / totalSlots) * 100);
    const remainingSlots = Math.max(0, totalSlots - filledSlots);

    const isRegistered = userRegistrationStatus === "CONFIRMED" || userRegistrationStatus === "WAITLIST" || userRegistrationStatus === "PENDING" || userRegistrationStatus === "CANCELLED";
    const isPast = dynamicStatus === "Past" || dynamicStatus === "Cancelled";

    return (
        <Card className={`overflow-hidden bg-gray-900 border-gray-800 hover:border-orange-500 transition-all duration-300 h-full flex flex-col group relative ${isPast ? 'opacity-60 grayscale' : ''}`}>
            <Link href={`/events/${event.eventId}`} className="block relative">
                {/* Image Section */}
                <div className="relative h-48 w-full bg-gray-800 overflow-hidden">
                    {event.logoUrl ? (
                        <Image
                            src={event.logoUrl}
                            alt={event.eventName}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            className="object-cover group-hover:scale-110 transition-transform duration-700"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-700 bg-gray-800">
                            <Calendar className="w-12 h-12 opacity-20" />
                        </div>
                    )}

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-linear-to-t from-gray-950 via-gray-950/40 to-transparent" />

                    {/* Price Badge (Top Left) */}
                    <div className="absolute top-3 left-3">
                        <div className="bg-black/80 backdrop-blur-sm px-3 py-1 rounded text-sm font-bold text-orange-500 border border-gray-800 shadow-lg">
                            {event.pricePerPlayer === 0 ? "Free" : `AED ${event.pricePerPlayer}`}
                            <span className="text-gray-400 text-xs font-normal ml-1">/ player</span>
                        </div>
                    </div>

                    {/* Status Badge (Top Right) */}
                    <div className="absolute top-3 right-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium bg-gray-950/80 backdrop-blur-sm border border-gray-800 text-gray-300`}>
                            {dynamicStatus}
                        </span>
                    </div>

                    {/* Title Overlay */}
                    <div className="absolute bottom-3 left-4 right-4">
                        <h3 className="text-lg font-bold text-white leading-tight shadow-black/50 drop-shadow-md">
                            {event.eventName}
                        </h3>
                    </div>
                </div>
            </Link>

            {/* Content Section */}
            <CardContent className="p-4 space-y-4 flex-1">
                {/* Progress Bar Section */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-400">
                        <div className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            <span>{filledSlots}/{totalSlots} {event.unitType === "Teams" ? "Teams" : "Players"}</span>
                        </div>
                        {remainingSlots > 0 ? (
                            <span className="text-green-500 font-medium">{remainingSlots} {event.unitType === "Teams" ? "teams" : "spots"} left</span>
                        ) : (
                            <span className="text-red-500 font-medium">Full</span>
                        )}
                    </div>
                    <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-orange-500 rounded-full transition-all duration-500"
                            style={{ width: `${progressPercentage}%` }}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm">
                    {/* Date */}
                    <div className="flex items-center text-gray-400">
                        <Calendar className="w-4 h-4 mr-2 shrink-0 text-gray-500" />
                        <span>{formattedDate}</span>
                    </div>

                    {/* Time & Duration */}
                    <div className="flex items-center text-gray-400">
                        <Clock className="w-4 h-4 mr-2 shrink-0 text-gray-500" />
                        <span>{formattedTime} ({event.duration}m)</span>
                    </div>

                    {/* Location (Clickable) */}
                    <div className="flex items-center text-gray-400 col-span-2">
                        <MapPin className="w-4 h-4 mr-2 shrink-0 text-gray-500" />
                        <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationName)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate hover:text-orange-500 hover:underline transition-colors"
                        >
                            {event.locationName}
                        </a>
                    </div>

                    {/* Event Type */}
                    <div className="flex items-center text-gray-400 col-span-2">
                        <div className="px-2 py-0.5 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300">
                            {event.unitType === "Teams" ? "Teams Event" : "Individual Event"}
                        </div>
                    </div>
                </div>
            </CardContent>

            {/* Footer Section with Button */}
            <CardFooter className="p-4 pt-0">
                {isPast ? (
                    <Link href={`/events/${event.eventId}`} className="w-full">
                        <Button
                            variant="outline"
                            className="w-full border-blue-800 text-blue-500 hover:text-white hover:bg-blue-700 hover:border-blue-700 transition-colors"
                        >
                            View Details
                        </Button>
                    </Link>
                ) : isRegistered ? (
                    <Link href={`/events/${event.eventId}`} className="w-full group/btn">
                        <Button className="w-full bg-green-600/20 text-green-500 border border-green-600/50 hover:bg-green-600 hover:text-white transition-all">
                            <span className="group-hover/btn:hidden">Already Registered</span>
                            <span className="hidden group-hover/btn:inline">View Details</span>
                        </Button>
                    </Link>
                ) : (
                    <Link href={`/events/${event.eventId}`} className="w-full">
                        <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold transition-colors">
                            Register Now
                        </Button>
                    </Link>
                )}
            </CardFooter>
        </Card>
    );
}
